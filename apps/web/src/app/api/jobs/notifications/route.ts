import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { sendTicketDelivery } from '@evolveit/shared/notify'

export const dynamic = 'force-dynamic'

interface OutboxRow {
  id: string
  kind: string
  to_phone: string
  payload: Record<string, string>
  attempts: number
}

/**
 * Drain the delivery outbox.
 *
 * Run it on a schedule — every minute is plenty. `claim_outbox_batch` marks
 * rows in flight with `FOR UPDATE SKIP LOCKED` and pushes their next attempt
 * out before this sends anything, so two overlapping runs never send the same
 * message and a crash mid-send does not spin.
 */
export async function POST(req: NextRequest) {
  const expected = process.env['CRON_SECRET']
  if (!expected || req.headers.get('x-cron-secret') !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = createSupabaseServiceRole()
  const { data, error } = await supabase.rpc('claim_outbox_batch', { p_limit: 25 })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const batch = (data ?? []) as OutboxRow[]
  let sent = 0
  let failed = 0

  for (const row of batch) {
    const p = row.payload ?? {}
    try {
      // Every kind resolves to the same two rails — WhatsApp template first,
      // SMS if that fails — so the payload carries whatever the template needs
      // and the deep link is the part that actually matters to the recipient.
      await sendTicketDelivery({
        buyerPhone: row.to_phone,
        buyerName: p['buyer_name'] ?? 'Guest',
        eventName: p['event_name'] ?? 'Memories Night Club',
        eventDate: p['event_date'] ?? '',
        ticketSerial: p['serial'] ?? p['reference'] ?? '',
        deepLink: p['deep_link'] ?? '',
        venueName: 'Memories Night Club',
      })
      await supabase.rpc('resolve_outbox', { p_id: row.id, p_ok: true, p_error: null })
      sent++
    } catch (err) {
      const message = err instanceof Error ? err.message : 'send failed'
      await supabase.rpc('resolve_outbox', {
        p_id: row.id,
        p_ok: false,
        p_error: message.slice(0, 500),
      })
      failed++
    }
  }

  return NextResponse.json({ ok: true, claimed: batch.length, sent, failed })
}
