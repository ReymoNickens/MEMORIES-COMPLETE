import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { normalisePhone } from '@evolveit/shared/phone'
import { makeError, ErrorCodes } from '@evolveit/shared/errors'

interface OrderInitiateRequest {
  token: string
  items: Array<{ product_id: string; quantity: number }>
  guest_name: string
  guest_phone: string
  payment_source: 'momo' | 'cash'
  waiter_id?: string
}

export async function POST(req: NextRequest) {
  let body: OrderInitiateRequest
  try {
    body = await req.json() as OrderInitiateRequest
  } catch {
    return NextResponse.json(makeError(ErrorCodes.NOT_FOUND, 'Invalid request body'), { status: 400 })
  }

  const { token, items, guest_name, guest_phone, payment_source, waiter_id } = body

  const normalisedPhone = normalisePhone(guest_phone)
  if (!normalisedPhone) {
    return NextResponse.json(makeError(ErrorCodes.PHONE_INVALID, 'Invalid Ghana phone number'), { status: 400 })
  }

  const supabase = createSupabaseServiceRole()

  // Resolve token to table or station
  const { data: tableData } = await supabase
    .from('venue_tables')
    .select('id, tenant_id, zone, label')
    .eq('qr_token', token)
    .eq('is_active', true)
    .single()

  // Counter tokens are not venue tables — look up in a separate store (future: station table)
  const isTableOrder = !!tableData
  const source = isTableOrder ? 'table_qr' : 'counter_qr'

  if (!isTableOrder && payment_source === 'cash') {
    return NextResponse.json(makeError(ErrorCodes.NOT_FOUND, 'Cash payment not allowed at counter'), { status: 400 })
  }

  if (!tableData && !isTableOrder) {
    // For now only table orders are fully implemented; counter needs station lookup
    return NextResponse.json(makeError(ErrorCodes.NOT_FOUND, 'QR token not found'), { status: 404 })
  }

  const tenantId = tableData?.tenant_id

  // Fetch products and compute total
  type ProductRow = { id: string; name: string; price_pesewas: number; station: string; is_available: boolean }
  const productIds = items.map(i => i.product_id)
  const { data: products } = await supabase
    .from('products')
    .select('id, name, price_pesewas, station, is_available')
    .in('id', productIds)
    .eq('tenant_id', tenantId)

  const typedProducts = (products ?? []) as ProductRow[]

  if (typedProducts.length !== productIds.length) {
    return NextResponse.json(makeError(ErrorCodes.NOT_FOUND, 'Some products not found'), { status: 404 })
  }

  const unavailable = typedProducts.find(p => !p.is_available)
  if (unavailable) {
    return NextResponse.json(makeError(ErrorCodes.NOT_FOUND, `${unavailable.name} is unavailable`), { status: 409 })
  }

  const totalPesewas = items.reduce((sum, item) => {
    const product = typedProducts.find(p => p.id === item.product_id)!
    return sum + product.price_pesewas * item.quantity
  }, 0)

  const paystackRef = payment_source === 'momo'
    ? `mnc-order-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
    : null

  // Create order
  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .insert({
      tenant_id: tenantId,
      venue_table_id: tableData?.id,
      source,
      guest_name,
      guest_phone: normalisedPhone,
      payment_source,
      paystack_ref: paystackRef,
      amount_pesewas: totalPesewas,
      status: payment_source === 'cash' ? 'paid' : 'pending_payment',
      waiter_id: waiter_id ?? null,
      paid_at: payment_source === 'cash' ? new Date().toISOString() : null,
    })
    .select('id')
    .single()

  if (orderErr || !order) {
    console.error('Order creation failed:', orderErr?.message)
    return NextResponse.json(makeError(ErrorCodes.NOT_FOUND, 'Order creation failed'), { status: 500 })
  }

  // Create order items
  const orderItems = items.map(item => {
    const product = typedProducts.find(p => p.id === item.product_id)!
    return {
      order_id: order.id,
      product_id: item.product_id,
      product_name: product.name,
      station: product.station,
      price_pesewas: product.price_pesewas,
      quantity: item.quantity,
    }
  })

  await supabase.from('order_items').insert(orderItems)

  // Cash orders: create cash_collections entry if waiter_id provided
  if (payment_source === 'cash' && waiter_id) {
    const { data: shift } = await supabase
      .from('shifts')
      .select('id')
      .eq('tenant_id', tenantId)
      .is('closed_at', null)
      .order('opened_at', { ascending: false })
      .limit(1)
      .single()

    if (shift) {
      await supabase.from('cash_collections').insert({
        tenant_id: tenantId,
        shift_id: shift.id,
        order_id: order.id,
        attributed_waiter_id: waiter_id,
        amount_pesewas: totalPesewas,
      })

      await supabase.from('ledger_entries').insert({
        tenant_id: tenantId,
        shift_id: shift.id,
        account: 'cash_drawer',
        direction: 'DR',
        amount_pesewas: totalPesewas,
        ref_type: 'order',
        ref_id: order.id,
        actor_id: waiter_id,
        memo: `Cash order: table ${tableData?.label}`,
      })
    }
  }

  // MoMo orders: call Paystack
  if (payment_source === 'momo' && paystackRef) {
    const paystackRes = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env['PAYSTACK_SECRET_KEY']}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: `${normalisedPhone.replace('+', '')}@momo.gh`,
        amount: totalPesewas,
        currency: 'GHS',
        reference: paystackRef,
        callback_url: `${process.env['NEXT_PUBLIC_APP_URL']}/order/return?ref=${paystackRef}`,
        metadata: { context: 'order', order_id: order.id },
      }),
    })

    if (!paystackRes.ok) {
      return NextResponse.json(makeError(ErrorCodes.PAYMENT_FAILED, 'Payment gateway error'), { status: 502 })
    }

    const paystackData = await paystackRes.json() as { data: { authorization_url: string } }
    return NextResponse.json({ order_id: order.id, authorization_url: paystackData.data.authorization_url })
  }

  return NextResponse.json({ order_id: order.id, status: 'paid' })
}
