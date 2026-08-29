import { createClient } from '@supabase/supabase-js'
import { decryptSecret } from '@evolveit/shared/crypto'
import { db } from './db.js'

const supabase = createClient(
  process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? process.env['SUPABASE_URL']!,
  process.env['SUPABASE_SERVICE_ROLE_KEY']!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

export async function syncDown(): Promise<void> {
  const windowEnd = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString()

  const { data: tickets } = await supabase
    .from('tickets')
    .select(`
      id, totp_secret_enc, buyer_name, status,
      ticket_types(name, event_id)
    `)
    .eq('status', 'issued')
    .filter('ticket_types.events.starts_at', 'lte', windowEnd)

  const upsertTicket = db.prepare(`
    INSERT OR REPLACE INTO hub_tickets (ticket_id, event_id, totp_secret, buyer_name, type_name, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `)

  for (const t of (tickets ?? [])) {
    const tt = t.ticket_types as { name: string; event_id: string } | null
    upsertTicket.run(
      t.id,
      tt?.event_id ?? '',
      decryptSecret(t.totp_secret_enc as string),
      t.buyer_name,
      tt?.name ?? 'General',
      t.status
    )
  }

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

  db.prepare(
    "INSERT INTO sync_log (direction, type, count) VALUES ('pull', 'tickets', ?)"
  ).run((tickets ?? []).length)
}

export async function syncUp(): Promise<void> {
  const unsynced = db.prepare('SELECT * FROM hub_redemptions WHERE synced = 0').all() as Array<{
    ticket_id: string
    device_id: string
    door_label: string
    scanned_at: string
  }>

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
    }
  }

  if (unsynced.length > 0) {
    db.prepare(
      "INSERT INTO sync_log (direction, type, count) VALUES ('push', 'redemptions', ?)"
    ).run(unsynced.length)
  }
}
