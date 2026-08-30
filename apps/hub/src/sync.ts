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
  const windowStart = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()

  // The old filter referenced ticket_types.events, a relation that was not in
  // the select, so PostgREST could not apply it — the hub either errored or
  // pulled every issued ticket the club had ever sold. Filter on the events
  // join explicitly, and make it an inner join so the constraint actually
  // narrows the result.
  const { data: tickets, error } = await supabase
    .from('tickets')
    .select(`
      id, totp_secret_enc, buyer_name, status, event_id,
      ticket_types!inner(name),
      events!inner(starts_at)
    `)
    .eq('status', 'issued')
    .lte('events.starts_at', windowEnd)
    .gte('events.starts_at', windowStart)

  if (error) {
    db.prepare(
      "INSERT INTO sync_log (direction, type, count, error) VALUES ('pull', 'tickets', 0, ?)"
    ).run(error.message)
    throw new Error(`syncDown failed: ${error.message}`)
  }

  const upsertTicket = db.prepare(`
    INSERT OR REPLACE INTO hub_tickets (ticket_id, event_id, totp_secret, buyer_name, type_name, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `)

  for (const t of (tickets ?? [])) {
    const embedded = t.ticket_types as unknown
    const tt = (Array.isArray(embedded) ? embedded[0] : embedded) as { name: string } | null
    upsertTicket.run(
      t.id,
      (t.event_id as string) ?? '',
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

  let pushed = 0
  const rejected: string[] = []

  for (const r of unsynced) {
    const { data, error } = await supabase.rpc('redeem_ticket', {
      p_ticket_id: r.ticket_id,
      p_device_id: r.device_id,
      p_device_name: 'Hub',
      p_door_label: r.door_label,
      p_mode: 'offline_deferred',
      p_scanned_at: r.scanned_at,
    })

    // A transport error means try again next tick. But redeem_ticket reports
    // refusals in its return value, not as an error — and a deferred scan
    // pushed after the door has closed comes back {ok:false,'outside_window'}.
    // The old code marked those synced anyway, so offline admissions
    // disappeared: the hub said the guest came in, the cloud never heard.
    if (error) continue

    const result = data as { ok?: boolean; reason?: string } | null
    const accepted = result?.ok === true
    // 'already_used' means the cloud has the redemption from another door.
    // That is reconciled, not lost.
    const reconciled = result?.reason === 'already_used'

    if (accepted || reconciled) {
      db.prepare('UPDATE hub_redemptions SET synced = 1 WHERE ticket_id = ?').run(r.ticket_id)
      pushed++
    } else {
      rejected.push(`${r.ticket_id}:${result?.reason ?? 'unknown'}`)
    }
  }

  if (unsynced.length > 0) {
    db.prepare(
      "INSERT INTO sync_log (direction, type, count, error) VALUES ('push', 'redemptions', ?, ?)"
    ).run(pushed, rejected.length ? rejected.join(',').slice(0, 2000) : null)
  }

  if (rejected.length > 0) {
    // These stay unsynced and keep retrying. Loud, because a door scan the
    // cloud will not accept is a guest who is in the building and off the
    // books, and someone has to reconcile it by hand.
    console.error(
      `syncUp: ${rejected.length} offline redemption(s) refused by the cloud:`,
      rejected.join(', ')
    )
  }
}
