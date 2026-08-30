import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { issueTicketsFromCheckout } from '@/lib/issue-tickets'
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
        await issueTicketsFromCheckout(supabase, checkout, {
          fee_pesewas: Number(payload.data.fees ?? 0) || 0,
          method: String(payload.data.channel ?? ''),
        })
      } catch (err) {
        await supabase.from('webhook_events').delete().eq('paystack_event_id', eventId)
        return NextResponse.json(
          { error: err instanceof Error ? err.message : 'issue_failed' },
          { status: 500 },
        )
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

    const { data: resv } = await supabase.from('table_reservations').select('id').eq('paystack_ref', ref).maybeSingle()
    if (resv) {
      await supabase.from('table_reservations').update({ status: 'confirmed', deposit_paid_at: new Date().toISOString() }).eq('id', resv.id)
    }
  }

  return NextResponse.json({ ok: true })
}
