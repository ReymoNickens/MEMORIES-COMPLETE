import { createClient } from '@supabase/supabase-js'
import { decryptSecret } from '@evolveit/shared/crypto'
import { db } from './db.js'

function totpKey(): string {
  const k = process.env['TOTP_ENCRYPTION_KEY']
  if (!k || k.length !== 64) throw new Error('TOTP_ENCRYPTION_KEY must be a 64-char hex string')
  return k
}

const supabase = createClient(
  process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? process.env['SUPABASE_URL']!,
  process.env['SUPABASE_SERVICE_ROLE_KEY']!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

export async function syncDown(): Promise<void> {
  // Pull tickets for events starting within the next 8 hours (two-step join)
  const now = new Date().toISOString()
  const windowEnd = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString()

  const { data: upcomingEvents } = await supabase
    .from('events')
    .select('id')
    .gte('starts_at', now)
    .lte('starts_at', windowEnd)

  const eventIds = (upcomingEvents ?? []).map((e: { id: string }) => e.id)

  let tickets: Array<{ id: string; totp_secret_enc: string; buyer_name: string; status: string; ticket_types: { name: string; event_id: string } | null }> = []

  if (eventIds.length > 0) {
    const { data: typeRows } = await supabase
      .from('ticket_types')
      .select('id, event_id')
      .in('event_id', eventIds)

    const typeIds = (typeRows ?? []).map((t: { id: string }) => t.id)

    if (typeIds.length > 0) {
      const { data } = await supabase
        .from('tickets')
        .select('id, totp_secret_enc, buyer_name, status, ticket_types(name, event_id)')
        .eq('status', 'issued')
        .in('ticket_type_id', typeIds)

      tickets = (data ?? []) as typeof tickets
    }
  }

  const upsertTicket = db.prepare(`
    INSERT OR REPLACE INTO hub_tickets (ticket_id, event_id, totp_secret, buyer_name, type_name, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `)

  for (const t of tickets) {
    const tt = t.ticket_types
    upsertTicket.run(
      t.id,
      tt?.event_id ?? '',
      decryptSecret(t.totp_secret_enc as string, totpKey()),
      t.buyer_name,
      tt?.name ?? 'General',
      t.status
    )
  }

  // Pull revocations
  const { data: revocations } = await supabase
    .from('revocations')
    .select('ticket_id, revoked_at')

  const upsertRevocation = db.prepare(`
    INSERT OR REPLACE INTO hub_revocations (ticket_id, revoked_at)
    VALUES (?, ?)
  `)
  for (const r of (revocations ?? [])) {
    upsertRevocation.run(r.ticket_id, r.revoked_at)
  }

  // Pull order status updates (bar/kitchen may have marked items via Supabase)
  const hubOrderIds = (db.prepare("SELECT order_id FROM hub_orders WHERE status NOT IN ('complete','voided')").all() as Array<{ order_id: string }>)
    .map(r => r.order_id)

  if (hubOrderIds.length > 0) {
    const { data: cloudOrders } = await supabase
      .from('orders')
      .select('id, status')
      .in('id', hubOrderIds)

    const updateOrderStatus = db.prepare('UPDATE hub_orders SET status = ? WHERE order_id = ?')
    for (const o of (cloudOrders ?? [])) {
      updateOrderStatus.run(o.status, o.id)
    }
  }

  db.prepare(
    "INSERT INTO sync_log (direction, type, count) VALUES ('pull', 'tickets', ?)"
  ).run(tickets.length)
}

export async function syncUp(): Promise<void> {
  // Push unsynced redemptions to cloud
  const unsynced = db.prepare('SELECT * FROM hub_redemptions WHERE synced = 0').all() as Array<{
    ticket_id: string
    device_id: string
    door_label: string
    scanned_at: string
  }>

  let pushed = 0
  for (const r of unsynced) {
    const { error } = await supabase.rpc('redeem_ticket', {
      p_ticket_id: r.ticket_id,
      p_device_id: r.device_id,
      p_device_name: 'Hub',
      p_door_label: r.door_label,
      p_mode: 'offline_deferred',
    })

    if (!error) {
      db.prepare('UPDATE hub_redemptions SET synced = 1 WHERE ticket_id = ?').run(r.ticket_id)
      pushed++
    }
  }

  if (pushed > 0) {
    db.prepare(
      "INSERT INTO sync_log (direction, type, count) VALUES ('push', 'redemptions', ?)"
    ).run(pushed)
  }
}
