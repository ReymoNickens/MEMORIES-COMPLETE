import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { normalisePhone } from '@evolveit/shared/phone'
import { makeError, ErrorCodes } from '@evolveit/shared/errors'
import { initializeCharge } from '@/lib/paystack'
import { demoPaymentsAllowed } from '@/lib/runtime'

/**
 * The second leg of an installment plan.
 *
 * `GET` tells a buyer what they still owe and by when; `POST` raises the
 * charge. Both are keyed on the checkout reference plus the phone the tickets
 * were bought against — the same pair that opens a pass — because a plan is
 * settled by whoever holds the link, and the reference alone should not be
 * enough to look up somebody's outstanding balance.
 */

async function findPlan(reference: string, phone: string) {
  const supabase = createSupabaseServiceRole()
  const { data: checkout } = await supabase
    .from('pending_checkouts')
    .select('id, tenant_id, event_id, quantity, amount_pesewas, buyer_name, buyer_phone, buyer_email, status, balance_ref')
    .eq('paystack_ref', reference)
    .maybeSingle()

  if (!checkout || checkout.buyer_phone !== phone) return { supabase, checkout: null, plans: [] }

  const { data: plans } = await supabase
    .from('payment_plans')
    .select('id, ticket_id, total_pesewas, paid_pesewas, deadline_at, status')
    .eq('checkout_id', checkout.id)

  return { supabase, checkout, plans: (plans ?? []) as Array<Record<string, unknown>> }
}

export async function GET(req: NextRequest) {
  const reference = req.nextUrl.searchParams.get('ref') ?? ''
  const phone = normalisePhone(req.nextUrl.searchParams.get('phone') ?? '')
  if (!reference || !phone) {
    return NextResponse.json({ error: 'Reference and phone number required' }, { status: 400 })
  }

  const { checkout, plans } = await findPlan(reference, phone)
  if (!checkout) return NextResponse.json({ error: 'That reference and number do not match' }, { status: 401 })

  const paid = plans.reduce((s, p) => s + Number(p['paid_pesewas'] ?? 0), 0)
  const total = Number(checkout.amount_pesewas)
  const active = plans.filter(p => p['status'] === 'active')

  return NextResponse.json({
    status: checkout.status,
    total_pesewas: total,
    paid_pesewas: paid,
    balance_pesewas: Math.max(0, total - paid),
    deadline_at: plans[0]?.['deadline_at'] ?? null,
    settled: checkout.status === 'issued',
    // A defaulted plan has had its tickets voided and its first leg refunded;
    // there is nothing left to pay.
    lapsed: plans.length > 0 && active.length === 0 && checkout.status !== 'issued',
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { reference?: string; phone?: string } | null
  const phone = normalisePhone(body?.phone ?? '')
  if (!body?.reference || !phone) {
    return NextResponse.json({ error: 'Reference and phone number required' }, { status: 400 })
  }

  const { supabase, checkout, plans } = await findPlan(body.reference, phone)
  if (!checkout) return NextResponse.json({ error: 'That reference and number do not match' }, { status: 401 })

  if (checkout.status === 'issued') {
    return NextResponse.json({ error: 'That plan is already paid in full', settled: true }, { status: 409 })
  }
  if (checkout.status !== 'part_paid') {
    return NextResponse.json({ error: 'No balance outstanding on that reference' }, { status: 409 })
  }
  if (plans.some(p => p['status'] !== 'active')) {
    return NextResponse.json(
      { error: 'That plan lapsed and the tickets were released. Buy again if the night is not sold out.' },
      { status: 409 },
    )
  }

  const deadline = plans[0]?.['deadline_at']
  if (deadline && new Date(String(deadline)) <= new Date()) {
    return NextResponse.json(
      { error: 'The balance deadline has passed. The tickets are being released.' },
      { status: 409 },
    )
  }

  const paid = plans.reduce((s, p) => s + Number(p['paid_pesewas'] ?? 0), 0)
  const balance = Number(checkout.amount_pesewas) - paid
  if (balance <= 0) return NextResponse.json({ error: 'Nothing outstanding' }, { status: 409 })

  // One reference per plan, reused across retries so an abandoned attempt does
  // not leave a second live charge behind.
  const balanceRef = (checkout.balance_ref as string | null) ?? `mnc_bal_${randomBytes(12).toString('hex')}`
  if (!checkout.balance_ref) {
    await supabase.from('pending_checkouts').update({ balance_ref: balanceRef }).eq('id', checkout.id)
  }

  if (demoPaymentsAllowed()) {
    const { error } = await supabase.rpc('complete_installment_balance', {
      p_checkout_id: checkout.id,
      p_paid_pesewas: balance,
      p_fee_pesewas: 0,
      p_paystack_ref: balanceRef,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ ok: true, demo: true, settled: true, paid_pesewas: balance })
  }

  const charge = await initializeCharge({
    email: String(checkout.buyer_email),
    amountPesewas: balance,
    reference: balanceRef,
    callbackPath: `/checkout/return?ref=${balanceRef}`,
    metadata: { context: 'ticket_balance', checkout_id: checkout.id },
  })

  if (!charge.ok) {
    return NextResponse.json(makeError(ErrorCodes.PAYMENT_FAILED, 'Payment gateway error'), { status: 502 })
  }

  return NextResponse.json({
    authorization_url: charge.data.authorization_url,
    reference: balanceRef,
    balance_pesewas: balance,
  })
}
