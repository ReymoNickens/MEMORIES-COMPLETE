import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { normalisePhone } from '@evolveit/shared/phone'
import { makeError, ErrorCodes } from '@evolveit/shared/errors'
import type { CheckoutInitiateRequest } from '@evolveit/shared/types'

export async function POST(req: NextRequest) {
  let body: CheckoutInitiateRequest
  try {
    body = await req.json() as CheckoutInitiateRequest
  } catch {
    return NextResponse.json(makeError(ErrorCodes.NOT_FOUND, 'Invalid request body'), { status: 400 })
  }

  const { ticket_type_id, quantity, buyer_name, buyer_phone, buyer_email } = body

  // Validate required fields
  if (!ticket_type_id || !buyer_name || !buyer_phone || !buyer_email) {
    return NextResponse.json(makeError(ErrorCodes.NOT_FOUND, 'Missing required fields'), { status: 400 })
  }

  const normalisedPhone = normalisePhone(buyer_phone)
  if (!normalisedPhone) {
    return NextResponse.json(makeError(ErrorCodes.PHONE_INVALID, 'Invalid Ghana phone number'), { status: 400 })
  }

  const qty = Math.min(Math.max(1, quantity || 1), 6)
  const supabase = createSupabaseServiceRole()

  // Fetch ticket type and event
  const { data: ticketType, error: ttErr } = await supabase
    .from('ticket_types')
    .select('*, events(*)')
    .eq('id', ticket_type_id)
    .single()

  if (ttErr || !ticketType) {
    return NextResponse.json(makeError(ErrorCodes.NOT_FOUND, 'Ticket type not found'), { status: 404 })
  }

  if (ticketType.remaining < qty) {
    return NextResponse.json(makeError(ErrorCodes.SOLD_OUT, 'Not enough tickets available'), { status: 409 })
  }

  const now = new Date()
  const saleStart = new Date(ticketType.sale_starts_at as string)
  const saleEnd = new Date(ticketType.sale_ends_at as string)
  if (now < saleStart || now > saleEnd) {
    return NextResponse.json(makeError(ErrorCodes.OUTSIDE_WINDOW, 'Ticket sales are not open'), { status: 400 })
  }

  const totalPesewas = (ticketType.price_pesewas as number) * qty
  const paystackRef = `mnc-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`

  // Create pending payment record — NOT a ticket yet
  const { error: payErr } = await supabase.from('ticket_payments').insert({
    ticket_id: '00000000-0000-0000-0000-000000000000', // placeholder; updated when ticket is issued
    tenant_id: ticketType.tenant_id,
    paystack_ref: paystackRef,
    amount_pesewas: totalPesewas,
    status: 'pending',
    method: 'momo',
  })

  if (payErr) {
    console.error('Failed to create payment record:', payErr.message)
    return NextResponse.json(makeError(ErrorCodes.PAYMENT_FAILED, 'Payment initialisation failed'), { status: 500 })
  }

  // Call Paystack Initialize Transaction
  const paystackRes = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env['PAYSTACK_SECRET_KEY']}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: buyer_email,
      amount: totalPesewas,
      currency: 'GHS',
      reference: paystackRef,
      callback_url: `${process.env['NEXT_PUBLIC_APP_URL']}/checkout/return?ref=${paystackRef}`,
      metadata: {
        context: 'ticket',
        ticket_type_id,
        buyer_name,
        buyer_phone: normalisedPhone,
        buyer_email,
        quantity: qty,
      },
    }),
  })

  if (!paystackRes.ok) {
    console.error('Paystack init failed:', paystackRes.status)
    return NextResponse.json(makeError(ErrorCodes.PAYMENT_FAILED, 'Payment gateway error'), { status: 502 })
  }

  const paystackData = await paystackRes.json() as { data: { authorization_url: string; reference: string } }

  return NextResponse.json({
    authorization_url: paystackData.data.authorization_url,
    reference: paystackRef,
  })
}
