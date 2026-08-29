import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { normalisePhone } from '@evolveit/shared/phone'
import { makeError, ErrorCodes } from '@evolveit/shared/errors'
import { issueTicketsFromCheckout } from '@/lib/issue-tickets'
import { demoPaymentsAllowed, paymentsConfigured } from '@/lib/runtime'
import type { CheckoutInitiateRequest } from '@evolveit/shared/types'
import { randomBytes } from 'node:crypto'

export async function POST(req: NextRequest) {
  let body: CheckoutInitiateRequest
  try {
    body = await req.json() as CheckoutInitiateRequest
  } catch {
    return NextResponse.json(makeError(ErrorCodes.NOT_FOUND, 'Invalid request body'), { status: 400 })
  }

  const { ticket_type_id, quantity, buyer_name, buyer_phone, buyer_email } = body
  if (!ticket_type_id || !buyer_name || !buyer_phone || !buyer_email) {
    return NextResponse.json(makeError(ErrorCodes.NOT_FOUND, 'Missing required fields'), { status: 400 })
  }

  const normalisedPhone = normalisePhone(buyer_phone)
  if (!normalisedPhone) {
    return NextResponse.json(makeError(ErrorCodes.PHONE_INVALID, 'Invalid Ghana phone number'), { status: 400 })
  }

  const qty = Math.min(Math.max(1, quantity || 1), 6)
  const supabase = createSupabaseServiceRole()

  const { data: ticketType, error: ttErr } = await supabase
    .from('ticket_types')
    .select('*, events(*)')
    .eq('id', ticket_type_id)
    .single()

  if (ttErr || !ticketType) {
    return NextResponse.json(makeError(ErrorCodes.NOT_FOUND, 'Ticket type not found'), { status: 404 })
  }

  const event = ticketType.events as { id: string; status: string }
  if (event.status !== 'published') {
    return NextResponse.json(makeError(ErrorCodes.NOT_FOUND, 'Event is not on sale'), { status: 400 })
  }

  if ((ticketType.remaining as number) < qty) {
    return NextResponse.json(makeError(ErrorCodes.SOLD_OUT, 'Not enough tickets available'), { status: 409 })
  }

  const now = new Date()
  if (now < new Date(ticketType.sale_starts_at as string) || now > new Date(ticketType.sale_ends_at as string)) {
    return NextResponse.json(makeError(ErrorCodes.OUTSIDE_WINDOW, 'Ticket sales are not open'), { status: 400 })
  }

  const totalPesewas = (ticketType.price_pesewas as number) * qty
  const paystackRef = `mnc_${randomBytes(12).toString('hex')}`

  if (!paymentsConfigured()) {
    return NextResponse.json(makeError(ErrorCodes.PAYMENT_FAILED, 'Payments are not configured'), { status: 503 })
  }

  const { error: pendingErr } = await supabase.from('pending_checkouts').insert({
    tenant_id: ticketType.tenant_id,
    ticket_type_id,
    event_id: ticketType.event_id,
    quantity: qty,
    buyer_name,
    buyer_phone: normalisedPhone,
    buyer_email,
    amount_pesewas: totalPesewas,
    paystack_ref: paystackRef,
    use_installments: !!body.use_installments,
    status: 'pending',
  })

  if (pendingErr) {
    return NextResponse.json(makeError(ErrorCodes.PAYMENT_FAILED, 'Checkout init failed'), { status: 500 })
  }

  if (demoPaymentsAllowed()) {
    return NextResponse.json({
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
    return NextResponse.json(makeError(ErrorCodes.PAYMENT_FAILED, 'Payment gateway error'), { status: 502 })
  }

  const paystackData = await paystackRes.json() as { data: { authorization_url: string; reference: string } }
  return NextResponse.json({
    authorization_url: paystackData.data.authorization_url,
    reference: paystackRef,
  })
}

export async function PUT(req: NextRequest) {
  if (!demoPaymentsAllowed()) {
    return NextResponse.json({ error: 'Live rail — wait for webhook' }, { status: 403 })
  }

  const body = await req.json().catch(() => null) as { reference?: string } | null
  if (!body?.reference) return NextResponse.json({ error: 'reference required' }, { status: 400 })

  const supabase = createSupabaseServiceRole()
  const { data: checkout } = await supabase
    .from('pending_checkouts')
    .select('*')
    .eq('paystack_ref', body.reference)
    .single()

  if (!checkout) return NextResponse.json({ error: 'Checkout not found' }, { status: 404 })
  if (checkout.status === 'issued') {
    return NextResponse.json({ ok: true, already: true })
  }

  await supabase.from('pending_checkouts').update({ status: 'paid' }).eq('id', checkout.id)
  try {
    const issued = await issueTicketsFromCheckout(supabase, checkout)
    return NextResponse.json({ ok: true, ...issued })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'issue_failed'
    return NextResponse.json({ error: msg }, { status: msg === 'sold_out' ? 409 : 500 })
  }
}
