import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { normalisePhone } from '@evolveit/shared/phone'
import { makeError, ErrorCodes } from '@evolveit/shared/errors'
import { getStaffSession } from '@/lib/staff-session'
import { demoPaymentsAllowed, paymentsConfigured, paystackLive } from '@/lib/runtime'

interface OrderInitiateRequest {
  token: string
  items: Array<{ product_id: string; quantity: number }>
  guest_name: string
  guest_phone: string
  payment_source: 'momo' | 'cash'
}

export async function POST(req: NextRequest) {
  let body: OrderInitiateRequest
  try {
    body = await req.json() as OrderInitiateRequest
  } catch {
    return NextResponse.json(makeError(ErrorCodes.NOT_FOUND, 'Invalid request body'), { status: 400 })
  }

  const { token, items, guest_name, guest_phone, payment_source } = body
  if (!token || !guest_name || !items?.length) {
    return NextResponse.json(makeError(ErrorCodes.NOT_FOUND, 'Missing order fields'), { status: 400 })
  }
  if (payment_source !== 'momo' && payment_source !== 'cash') {
    return NextResponse.json(makeError(ErrorCodes.NOT_FOUND, 'Pay with MoMo or cash'), { status: 400 })
  }

  const normalisedPhone = normalisePhone(guest_phone)
  if (!normalisedPhone) {
    return NextResponse.json(makeError(ErrorCodes.PHONE_INVALID, 'Invalid Ghana phone number'), { status: 400 })
  }

  const lines = items
    .map(i => ({ product_id: i.product_id, quantity: Math.min(20, Math.max(1, Math.floor(i.quantity || 1))) }))
    .slice(0, 30)

  const supabase = createSupabaseServiceRole()
  const staff = await getStaffSession()

  const { data: table } = await supabase
    .from('venue_tables')
    .select('id, tenant_id, label')
    .eq('qr_token', token)
    .eq('is_active', true)
    .maybeSingle()

  const { data: station } = !table
    ? await supabase
      .from('stations')
      .select('id, tenant_id, kind, label')
      .eq('qr_token', token)
      .eq('is_active', true)
      .maybeSingle()
    : { data: null }

  if (!table && !station) {
    return NextResponse.json(makeError(ErrorCodes.NOT_FOUND, 'QR token not found'), { status: 404 })
  }

  const tenantId = (table?.tenant_id ?? station?.tenant_id) as string
  const source = table ? 'table_qr' : 'counter_qr'
  const stationLabel = table ? (table.label as string) : (station?.label as string)

  if (payment_source === 'cash') {
    if (!staff || staff.tenant_id !== tenantId) {
      return NextResponse.json({ error: 'Cash must be taken by signed-in staff' }, { status: 401 })
    }
  }

  if (payment_source === 'momo' && !paymentsConfigured()) {
    return NextResponse.json(makeError(ErrorCodes.PAYMENT_FAILED, 'Payments are not configured'), { status: 503 })
  }

  let shiftId: string | null = null
  if (payment_source === 'cash') {
    const { data: shift } = await supabase
      .from('shifts')
      .select('id')
      .eq('tenant_id', tenantId)
      .is('closed_at', null)
      .order('opened_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!shift) {
      return NextResponse.json({ error: 'Open a shift before taking cash' }, { status: 409 })
    }
    shiftId = shift.id as string
  }

  const paystackRef = payment_source === 'momo' ? `mnc_ord_${randomBytes(12).toString('hex')}` : null

  const { data, error } = await supabase.rpc('place_order', {
    p_tenant_id: tenantId,
    p_source: source,
    p_guest_name: guest_name.trim(),
    p_guest_phone: normalisedPhone,
    p_payment_source: payment_source,
    p_paystack_ref: paystackRef,
    p_venue_table_id: table?.id ?? null,
    p_station_label: stationLabel,
    p_waiter_id: payment_source === 'cash' ? staff!.user_id : null,
    p_shift_id: shiftId,
    p_items: lines,
  })

  if (error) {
    const msg = error.message ?? ''
    if (msg.includes('product_unavailable')) {
      return NextResponse.json(makeError(ErrorCodes.NOT_FOUND, 'An item is no longer available'), { status: 409 })
    }
    return NextResponse.json(makeError(ErrorCodes.NOT_FOUND, msg || 'Order failed'), { status: 400 })
  }

  const placed = data as { order_id: string; amount_pesewas: number }

  if (payment_source === 'cash') {
    return NextResponse.json({ order_id: placed.order_id, status: 'paid', amount_pesewas: placed.amount_pesewas })
  }

  if (demoPaymentsAllowed() && !paystackLive()) {
    return NextResponse.json({
      order_id: placed.order_id,
      authorization_url: `/checkout/return?ref=${paystackRef}&demo=1`,
      reference: paystackRef,
      demo: true,
    })
  }

  const paystackRes = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env['PAYSTACK_SECRET_KEY']}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: `${normalisedPhone.replace('+', '')}@momo.gh`,
      amount: placed.amount_pesewas,
      currency: 'GHS',
      reference: paystackRef,
      callback_url: `${process.env['NEXT_PUBLIC_APP_URL']}/checkout/return?ref=${paystackRef}`,
      metadata: { context: 'order', order_id: placed.order_id },
    }),
  })

  if (!paystackRes.ok) {
    return NextResponse.json(makeError(ErrorCodes.PAYMENT_FAILED, 'Payment gateway error'), { status: 502 })
  }

  const paystackData = await paystackRes.json() as { data: { authorization_url: string } }
  return NextResponse.json({
    order_id: placed.order_id,
    authorization_url: paystackData.data.authorization_url,
    reference: paystackRef,
  })
}
