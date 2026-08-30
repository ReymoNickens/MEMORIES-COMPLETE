import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { normalisePhone } from '@evolveit/shared/phone'
import { makeError, ErrorCodes } from '@evolveit/shared/errors'
import { issueTicketsFromCheckout } from '@/lib/issue-tickets'
import { demoPaymentsAllowed, paymentsConfigured } from '@/lib/runtime'
import { initializeCharge } from '@/lib/paystack'
import type { CheckoutInitiateRequest } from '@evolveit/shared/types'
import { randomBytes } from 'node:crypto'
import * as OTPAuth from 'otpauth'
import { encodeTotpSecret, randomToken, sha256Hex } from '@evolveit/shared/crypto'
import { refundCheckout } from '@/lib/refund'

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

  const event = ticketType.events as { id: string; status: string; starts_at: string }
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

  // Installments: half now, the balance by 48 hours before doors. The flag has
  // been on and `use_installments` written to the checkout since launch, but
  // nothing ever charged a first leg or created a plan — a buyer who chose to
  // pay in two was charged in full like everyone else.
  const wantsInstallments = !!body.use_installments
  const allowsInstallments = !!ticketType.allow_installments
  const deadline = new Date(new Date(event.starts_at).getTime() - 48 * 60 * 60 * 1000)

  if (wantsInstallments && !allowsInstallments) {
    return NextResponse.json(
      makeError(ErrorCodes.NOT_FOUND, 'This ticket must be paid in full'),
      { status: 400 },
    )
  }
  if (wantsInstallments && deadline <= now) {
    return NextResponse.json(
      makeError(ErrorCodes.OUTSIDE_WINDOW, 'Too close to the night to pay in two — pay in full'),
      { status: 400 },
    )
  }

  const useInstallments = wantsInstallments && allowsInstallments
  // Round the first leg up, so the club never carries more than half.
  const chargeNowPesewas = useInstallments
    ? Math.ceil(totalPesewas / 2)
    : totalPesewas

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
    use_installments: useInstallments,
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
      installments: useInstallments,
      charge_now_pesewas: chargeNowPesewas,
      balance_pesewas: totalPesewas - chargeNowPesewas,
      balance_due_at: useInstallments ? deadline.toISOString() : null,
    })
  }

  const charge = await initializeCharge({
    email: buyer_email,
    amountPesewas: chargeNowPesewas,
    reference: paystackRef,
    callbackPath: `/checkout/return?ref=${paystackRef}`,
    metadata: {
      context: 'ticket',
      ticket_type_id,
      buyer_name,
      buyer_phone: normalisedPhone,
      buyer_email,
      quantity: qty,
      installments: useInstallments,
    },
  })

  if (!charge.ok) {
    return NextResponse.json(
      makeError(ErrorCodes.PAYMENT_FAILED, 'Payment gateway error'),
      { status: 502 },
    )
  }

  return NextResponse.json({
    authorization_url: charge.data.authorization_url,
    reference: paystackRef,
    installments: useInstallments,
    charge_now_pesewas: chargeNowPesewas,
    balance_pesewas: totalPesewas - chargeNowPesewas,
    balance_due_at: useInstallments ? deadline.toISOString() : null,
  })
}

/**
 * Demo rail only: stand in for the Paystack webhook so a local checkout can be
 * driven to a ticket without real money. Refuses outright once a live key is
 * present — this endpoint issues tickets against no payment.
 */
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
    .maybeSingle()

  if (!checkout) return NextResponse.json({ error: 'Checkout not found' }, { status: 404 })
  if (checkout.status === 'issued') return NextResponse.json({ ok: true, already: true })

  await supabase.from('pending_checkouts').update({ status: 'paid' }).eq('id', checkout.id)

  // The installment path issues reserved tickets and a plan; the buyer settles
  // the balance later through /api/checkout/balance.
  if (checkout.use_installments && checkout.status !== 'part_paid') {
    const paidNow = Math.ceil(Number(checkout.amount_pesewas) / 2)
    const tokens = Array.from({ length: checkout.quantity }, () => randomToken(18))
    const bundle = tokens.map((token, i) => ({
      totp_enc: encodeTotpSecret(new OTPAuth.Secret({ size: 20 }).base32),
      access_hash: sha256Hex(token),
      fee_pesewas: 0,
      method: 'momo',
      paystack_ref: `${checkout.paystack_ref}-${i + 1}`,
    }))
    const { data, error } = await supabase.rpc('complete_installment_checkout', {
      p_checkout_id: checkout.id,
      p_tickets: bundle,
      p_paid_pesewas: paidNow,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    const result = data as { ticket_ids?: string[]; balance_pesewas?: number; deadline_at?: string }
    return NextResponse.json({
      ok: true,
      installments: true,
      ticket_ids: result.ticket_ids ?? [],
      access_tokens: tokens,
      balance_pesewas: result.balance_pesewas,
      deadline_at: result.deadline_at,
    })
  }

  try {
    const issued = await issueTicketsFromCheckout(supabase, checkout)
    return NextResponse.json({ ok: true, ...issued })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'issue_failed'
    // Same policy as the live rail: a sold-out race gives the money back.
    if (msg === 'sold_out') {
      const outcome = await refundCheckout(supabase, checkout, 'sold out before payment cleared')
      return NextResponse.json({ error: msg, refunded: outcome.refunded }, { status: 409 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
