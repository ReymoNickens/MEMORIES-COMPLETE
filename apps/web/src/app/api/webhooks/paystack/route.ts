import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { issueTicketsFromCheckout } from '@/lib/issue-tickets'
import { refundCheckout } from '@/lib/refund'
import { webhookEventId } from '@/lib/runtime'

function verify(raw: string, signature: string): boolean {
  const secret = process.env['PAYSTACK_WEBHOOK_SECRET'] || ''
  if (!secret || !signature) return false
  const expected = createHmac('sha512', secret).update(raw).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export async function POST(req: NextRequest) {
  const raw = await req.text()
  const signature = req.headers.get('x-paystack-signature') || ''
  if (!verify(raw, signature)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  let payload: { event?: string; data?: Record<string, unknown>; id?: unknown }
  try {
    payload = JSON.parse(raw) as { event?: string; data?: Record<string, unknown>; id?: unknown }
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  let eventId: string
  try {
    eventId = webhookEventId(payload)
  } catch {
    return NextResponse.json({ error: 'missing event id' }, { status: 400 })
  }

  const supabase = createSupabaseServiceRole()
  const { error: dup } = await supabase.from('webhook_events').insert({
    paystack_event_id: eventId,
    event_type: payload.event ?? 'unknown',
    raw_payload: payload,
  })
  if (dup?.code === '23505') return NextResponse.json({ ok: true, duplicate: true })

  if (payload.event === 'charge.success' && payload.data) {
    const ref = String(payload.data.reference ?? '')
    if (!ref) return NextResponse.json({ ok: true, ignored: 'no_reference' })

    // A valid signature proves Paystack sent this, not that the customer paid
    // what we asked for. Partial debits, currency mismatches and abandoned
    // charges all arrive on this endpoint, so read the amount off the payload
    // and refuse anything that does not settle the checkout in full.
    const paidPesewas = Number(payload.data.amount ?? 0)
    const currency = String(payload.data.currency ?? 'GHS')
    const chargeStatus = String(payload.data.status ?? 'success')

    const { data: checkout } = await supabase
      .from('pending_checkouts')
      .select('*')
      .eq('paystack_ref', ref)
      .maybeSingle()

    if (checkout && checkout.status !== 'issued') {
      const expected = Number(checkout.amount_pesewas)
      if (chargeStatus !== 'success' || currency !== 'GHS' || !Number.isFinite(paidPesewas) || paidPesewas < expected) {
        // Leave the checkout pending rather than failing it: Paystack retries,
        // and a customer who completes a second leg should still get tickets.
        await supabase.from('webhook_events').delete().eq('paystack_event_id', eventId)
        return NextResponse.json(
          {
            ok: false,
            ignored: 'underpaid_or_unsuccessful',
            expected_pesewas: expected,
            paid_pesewas: Number.isFinite(paidPesewas) ? paidPesewas : 0,
            currency,
            status: chargeStatus,
          },
          { status: 200 },
        )
      }

      await supabase.from('pending_checkouts').update({ status: 'paid' }).eq('id', checkout.id)
      try {
        if (checkout.use_installments) {
          // Half now, the balance by 48 hours before doors. The tickets exist
          // immediately but come out 'reserved', so they will not open the
          // door until the plan completes.
          await issueInstallmentFirstLeg(supabase, checkout, paidPesewas, Number(payload.data.fees ?? 0) || 0)
        } else {
          await issueTicketsFromCheckout(supabase, checkout, {
            fee_pesewas: Number(payload.data.fees ?? 0) || 0,
            method: String(payload.data.channel ?? ''),
          })
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'issue_failed'

        // The one failure that is not ours to retry: the customer paid, and
        // between the stock check at initiation and this webhook another buyer
        // took the last seats. The club never oversells, so the money goes
        // back rather than being held against a ticket that cannot exist.
        if (message.includes('sold_out')) {
          const outcome = await refundCheckout(
            supabase,
            checkout,
            'sold out before payment cleared',
          )
          // Acknowledged either way: retrying the webhook cannot un-sell the
          // seats, and a refund that failed is recorded for a human to chase.
          return NextResponse.json({
            ok: true,
            sold_out: true,
            refunded: outcome.refunded,
            refund_error: outcome.error ?? null,
          })
        }

        await supabase.from('webhook_events').delete().eq('paystack_event_id', eventId)
        return NextResponse.json({ error: message }, { status: 500 })
      }
    }

    // The second leg of an installment plan, keyed by its own reference.
    const { data: plannedCheckout } = await supabase
      .from('pending_checkouts')
      .select('id, amount_pesewas, status')
      .eq('balance_ref', ref)
      .maybeSingle()

    if (plannedCheckout && plannedCheckout.status === 'part_paid') {
      const { error: balErr } = await supabase.rpc('complete_installment_balance', {
        p_checkout_id: plannedCheckout.id,
        p_paid_pesewas: paidPesewas,
        p_fee_pesewas: Number(payload.data.fees ?? 0) || 0,
        p_paystack_ref: ref,
      })
      if (balErr) {
        await supabase.from('webhook_events').delete().eq('paystack_event_id', eventId)
        return NextResponse.json({ error: balErr.message }, { status: 500 })
      }
    }

    const { data: order } = await supabase
      .from('orders')
      .select('id, amount_pesewas')
      .eq('paystack_ref', ref)
      .maybeSingle()
    if (order) {
      if (chargeStatus !== 'success' || currency !== 'GHS' || paidPesewas < Number(order.amount_pesewas)) {
        await supabase.from('webhook_events').delete().eq('paystack_event_id', eventId)
        return NextResponse.json({ ok: false, ignored: 'order_underpaid' }, { status: 200 })
      }
      const { error: paidErr } = await supabase.rpc('mark_order_paid', {
        p_order_id: order.id,
        p_fee_pesewas: Number(payload.data.fees ?? 0) || 0,
      })
      if (paidErr) {
        await supabase.from('webhook_events').delete().eq('paystack_event_id', eventId)
        return NextResponse.json({ error: paidErr.message }, { status: 500 })
      }
    }

    // A table deposit. The old branch flipped two columns and booked nothing,
    // so the money the club was holding never appeared anywhere.
    const { data: resv } = await supabase
      .from('table_reservations')
      .select('id')
      .eq('paystack_ref', ref)
      .maybeSingle()
    if (resv) {
      const { error: depErr } = await supabase.rpc('confirm_reservation_deposit', {
        p_reservation_id: resv.id,
        p_paid_pesewas: paidPesewas,
        p_paystack_ref: ref,
      })
      if (depErr) {
        await supabase.from('webhook_events').delete().eq('paystack_event_id', eventId)
        return NextResponse.json({ error: depErr.message }, { status: 500 })
      }
    }
  }

  // Paystack acknowledges a refund request immediately and confirms it has
  // settled later. settle_checkout_refund is idempotent, so this only closes
  // out a refund whose request-time write did not land.
  if ((payload.event === 'refund.processed' || payload.event === 'refund.failed') && payload.data) {
    const originalRef = String(
      (payload.data['transaction_reference'] as string | undefined) ??
      ((payload.data['transaction'] as Record<string, unknown> | undefined)?.['reference'] as string | undefined) ??
      '',
    )
    if (originalRef) {
      const { data: co } = await supabase
        .from('pending_checkouts')
        .select('id')
        .eq('paystack_ref', originalRef)
        .maybeSingle()
      if (co) {
        await supabase.rpc('settle_checkout_refund', {
          p_checkout_id: co.id,
          p_ok: payload.event === 'refund.processed',
          p_fee_kept_pesewas: 0,
          p_error: payload.event === 'refund.failed' ? 'paystack reported refund.failed' : null,
        })
      }
    }
  }

  return NextResponse.json({ ok: true })
}

/**
 * First installment leg. Mirrors issueTicketsFromCheckout's bundle building —
 * the TOTP secret and the access-token hash are generated here in Node and
 * only their encrypted / hashed forms reach the database.
 */
async function issueInstallmentFirstLeg(
  supabase: ReturnType<typeof createSupabaseServiceRole>,
  checkout: { id: string; quantity: number; amount_pesewas: number; paystack_ref: string },
  paidPesewas: number,
  feePesewas: number,
) {
  const { encodeTotpSecret, randomToken, sha256Hex } = await import('@evolveit/shared/crypto')
  const OTPAuth = await import('otpauth')

  const tokens = Array.from({ length: checkout.quantity }, () => randomToken(18))
  const bundle = tokens.map((token, i) => ({
    totp_enc: encodeTotpSecret(new OTPAuth.Secret({ size: 20 }).base32),
    access_hash: sha256Hex(token),
    fee_pesewas: i === 0 ? feePesewas : 0,
    method: 'momo',
    paystack_ref: `${checkout.paystack_ref}-${i + 1}`,
  }))

  const { error } = await supabase.rpc('complete_installment_checkout', {
    p_checkout_id: checkout.id,
    p_tickets: bundle,
    p_paid_pesewas: paidPesewas,
  })
  if (error) throw new Error(error.message)
}
