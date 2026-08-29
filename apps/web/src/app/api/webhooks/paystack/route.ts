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

    const { data: checkout } = await supabase
      .from('pending_checkouts')
      .select('*')
      .eq('paystack_ref', ref)
      .maybeSingle()

    if (checkout && checkout.status !== 'issued') {
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

    const { data: order } = await supabase.from('orders').select('id').eq('paystack_ref', ref).maybeSingle()
    if (order) {
      await supabase.from('orders').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', order.id)
    }

    const { data: resv } = await supabase.from('table_reservations').select('id').eq('paystack_ref', ref).maybeSingle()
    if (resv) {
      await supabase.from('table_reservations').update({ status: 'confirmed', deposit_paid_at: new Date().toISOString() }).eq('id', resv.id)
    }
  }

  return NextResponse.json({ ok: true })
}
