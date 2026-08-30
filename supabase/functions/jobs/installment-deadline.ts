import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const PAYSTACK = 'https://api.paystack.co'

/**
 * Two jobs in one pass over the plans that are still open:
 *
 *   · anything due inside 24 hours gets one reminder, because a plan that
 *     lapses for want of a text is a seat the club sold twice and delivered
 *     once;
 *   · anything past its deadline defaults — the ticket is voided, the seat
 *     goes back on sale, the club keeps a 10% forfeiture and the rest is
 *     refunded.
 *
 * The old version hand-wrote the void, the revocation and a Paystack refund
 * per payment row, and wrote nothing at all to the ledger — so a forfeiture
 * never reached the P&L and the money held against the plan was never
 * discharged. `default_installment_plan` does the whole thing in one
 * transaction; this only has to move the money and report.
 */
Deno.serve(async (req) => {
  const cronSecret = Deno.env.get('CRON_SECRET')
  if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) {
    return new Response('Unauthorized', { status: 401 })
  }

  const now = new Date()
  const soon = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()

  // ── Remind, once ──────────────────────────────────────────────────────────
  const { data: dueSoon } = await supabase
    .from('payment_plans')
    .select('id, tenant_id, ticket_id, total_pesewas, paid_pesewas, deadline_at, checkout_id')
    .eq('status', 'active')
    .is('reminded_at', null)
    .gt('deadline_at', now.toISOString())
    .lt('deadline_at', soon)

  let reminded = 0
  for (const plan of (dueSoon ?? [])) {
    const { data: ticket } = await supabase
      .from('tickets')
      .select('buyer_name, buyer_phone, tenant_id, events(name, starts_at)')
      .eq('id', plan.ticket_id)
      .maybeSingle()
    if (!ticket) continue

    const { data: checkout } = await supabase
      .from('pending_checkouts')
      .select('paystack_ref')
      .eq('id', plan.checkout_id)
      .maybeSingle()

    const event = ticket.events as { name?: string; starts_at?: string } | null
    const outstanding = Number(plan.total_pesewas) - Number(plan.paid_pesewas)

    // Queued, not sent inline — the outbox retries and survives a crash.
    const { error } = await supabase.from('notification_outbox').insert({
      tenant_id: ticket.tenant_id,
      kind: 'installment_reminder',
      to_phone: ticket.buyer_phone,
      payload: {
        buyer_name: ticket.buyer_name,
        event_name: event?.name ?? 'Memories Night Club',
        event_date: event?.starts_at ?? '',
        reference: `GHS ${(outstanding / 100).toFixed(2)} due`,
        deep_link: `${Deno.env.get('APP_URL') ?? ''}/checkout/balance?ref=${checkout?.paystack_ref ?? ''}`,
      },
      dedupe_key: `reminder:${plan.id}`,
    })
    if (error && error.code !== '23505') continue

    await supabase.from('payment_plans').update({ reminded_at: now.toISOString() }).eq('id', plan.id)
    reminded++
  }

  // ── Default what has run out of time ──────────────────────────────────────
  const { data: expired } = await supabase
    .from('payment_plans')
    .select('id, ticket_id')
    .eq('status', 'active')
    .lt('deadline_at', now.toISOString())

  let defaulted = 0
  let refundFailures = 0

  for (const plan of (expired ?? [])) {
    // The database call is the source of truth: it voids the ticket, revokes
    // it, returns the seat to stock and books the forfeiture and the refund.
    const { data, error } = await supabase.rpc('default_installment_plan', {
      p_plan_id: plan.id,
      p_forfeit_bps: 1000,
    })
    if (error) {
      console.error(`plan ${plan.id} default failed: ${error.message}`)
      continue
    }

    const result = data as { already?: boolean; refund_pesewas?: number } | null
    if (result?.already) continue
    defaulted++

    const refund = Number(result?.refund_pesewas ?? 0)
    if (refund <= 0) continue

    // Move the money. The ledger already reflects the intent; a failure here
    // is loud because it means a customer is owed and has not been paid.
    const { data: payments } = await supabase
      .from('ticket_payments')
      .select('paystack_ref, amount_pesewas')
      .eq('ticket_id', plan.ticket_id)
      .eq('status', 'successful')
      .order('created_at')
      .limit(1)

    const original = payments?.[0]?.paystack_ref
    if (!original) { refundFailures++; continue }

    try {
      const res = await fetch(`${PAYSTACK}/refund`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${Deno.env.get('PAYSTACK_SECRET_KEY')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transaction: original,
          amount: refund,
          merchant_note: 'Memories: installment deadline missed',
        }),
      })
      if (!res.ok) throw new Error(`paystack ${res.status}`)
      await supabase
        .from('ticket_payments')
        .update({ status: 'refunded', refunded_at: now.toISOString() })
        .eq('paystack_ref', original)
    } catch (err) {
      refundFailures++
      console.error(
        `plan ${plan.id}: refund of ${refund} pesewas failed — customer is owed:`,
        (err as Error).message,
      )
    }
  }

  return new Response(
    JSON.stringify({ reminded, defaulted, refund_failures: refundFailures }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
})
