import express from 'express'
import { randomBytes } from 'node:crypto'
import { db } from './db.js'
import { syncDown, syncUp } from './sync.js'
import { verifyTotp } from '@evolveit/shared/totp'
import { hashDeviceKey } from '@evolveit/shared/crypto'
import type { RedeemRequest, RedeemResult } from '@evolveit/shared/types'

const app = express()
app.use(express.json())

const PORT = process.env['HUB_PORT'] ? parseInt(process.env['HUB_PORT']) : 3001
const HUB_SECRET = process.env['HUB_SECRET'] ?? ''

// SSE clients for bar/kitchen displays
const sseClients = new Map<number, { res: express.Response; station: string }>()
let clientIdCounter = 0

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/v1/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() })
})

// ── Door scanner: redeem ticket ───────────────────────────────────────────────
app.post('/v1/redeem', (req, res) => {
  const { ticket_id, totp_code, device_id, door_label } = req.body as RedeemRequest

  // 1. Verify device credential
  const device = db.prepare('SELECT * FROM hub_devices WHERE id = ?').get(device_id) as
    { id: string; name: string; role: string; key_hash: string; revoked_at: string | null } | undefined

  if (!device || device.revoked_at) {
    return res.status(401).json({ ok: false, reason: 'unauthorized' } satisfies RedeemResult)
  }

  // 2. Check revocations
  const revoked = db.prepare('SELECT 1 FROM hub_revocations WHERE ticket_id = ?').get(ticket_id)
  if (revoked) {
    return res.json({ ok: false, reason: 'voided' } satisfies RedeemResult)
  }

  // 3. Get ticket secret
  const ticket = db.prepare('SELECT * FROM hub_tickets WHERE ticket_id = ?').get(ticket_id) as
    { ticket_id: string; totp_secret: string; buyer_name: string; type_name: string; status: string } | undefined

  if (!ticket) {
    return res.json({ ok: false, reason: 'not_in_hub' } satisfies RedeemResult)
  }

  // 4. Verify TOTP (never log the secret)
  const valid = verifyTotp(ticket.totp_secret, totp_code, 1)
  if (!valid) {
    return res.json({ ok: false, reason: 'invalid_code' } satisfies RedeemResult)
  }

  // 5. Atomic compare-and-swap using SQLite exclusive transaction
  const result = db.transaction((): RedeemResult => {
    const existing = db.prepare(
      'SELECT * FROM hub_redemptions WHERE ticket_id = ?'
    ).get(ticket_id) as { scanned_at: string; door_label: string } | undefined

    if (existing) {
      return {
        ok: false,
        reason: 'already_used',
        scanned_at: existing.scanned_at,
        door_label: existing.door_label,
      }
    }

    db.prepare(
      'INSERT INTO hub_redemptions (ticket_id, device_id, door_label, scanned_at, synced) VALUES (?, ?, ?, ?, 0)'
    ).run(ticket_id, device_id, door_label, new Date().toISOString())

    return {
      ok: true,
      holder_name: ticket.buyer_name,
      ticket_type: ticket.type_name,
    }
  })()

  return res.json(result)
})

// ── Capacity ──────────────────────────────────────────────────────────────────
app.get('/v1/capacity', (_req, res) => {
  const count = (db.prepare('SELECT COUNT(*) as n FROM hub_redemptions').get() as { n: number }).n
  res.json({ admitted: count })
})

// ── Order fan-out via SSE ─────────────────────────────────────────────────────
app.post('/v1/order', (req, res) => {
  const secret = req.headers['x-hub-secret']
  if (secret !== HUB_SECRET) return res.status(401).json({ error: 'unauthorized' })

  const order = req.body as { order_id: string; station: string; table_label?: string; items: unknown[] }
  const token = order.order_id.slice(-4).toUpperCase()

  db.prepare(
    'INSERT OR REPLACE INTO hub_orders (order_id, station, table_label, token, status, items, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    order.order_id,
    order.station,
    order.table_label ?? null,
    token,
    'paid',
    JSON.stringify(order.items),
    new Date().toISOString()
  )

  // Broadcast to matching SSE clients
  const payload = JSON.stringify({ type: 'new_order', order: { ...order, token } })
  for (const [, client] of sseClients) {
    if (client.station === order.station) {
      client.res.write(`data: ${payload}\n\n`)
    }
  }

  return res.json({ ok: true })
})

// ── SSE queue for bar/kitchen displays ───────────────────────────────────────
app.get('/v1/queue/:station', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  const station = req.params['station']!
  const clientId = ++clientIdCounter
  sseClients.set(clientId, { res, station })

  // Send current queue on connect
  const queue = db.prepare(
    "SELECT * FROM hub_orders WHERE station = ? AND status IN ('paid', 'preparing') ORDER BY created_at ASC"
  ).all(station)
  res.write(`data: ${JSON.stringify({ type: 'init', orders: queue })}\n\n`)

  req.on('close', () => sseClients.delete(clientId))
})

// ── Device management ────────────────────────────────────────────────────────
// POST /v1/devices — register a new device; returns a one-time raw API key
app.post('/v1/devices', (req, res) => {
  const secret = req.headers['x-hub-secret']
  if (secret !== HUB_SECRET) return res.status(401).json({ error: 'unauthorized' })

  const { name, role } = req.body as { name?: string; role?: string }
  if (!name || !role) return res.status(400).json({ error: 'name and role required' })
  if (!['door', 'hub', 'bar', 'kitchen'].includes(role)) {
    return res.status(400).json({ error: 'invalid role' })
  }

  const rawKey = randomBytes(32).toString('hex')
  const id = randomBytes(8).toString('hex')
  const keyHash = hashDeviceKey(rawKey)

  db.prepare(
    'INSERT INTO hub_devices (id, name, role, key_hash) VALUES (?, ?, ?, ?)'
  ).run(id, name, role, keyHash)

  return res.json({ id, name, role, api_key: rawKey })
})

// DELETE /v1/devices/:id — revoke a device
app.delete('/v1/devices/:id', (req, res) => {
  const secret = req.headers['x-hub-secret']
  if (secret !== HUB_SECRET) return res.status(401).json({ error: 'unauthorized' })

  const id = req.params['id']!
  const device = db.prepare('SELECT id FROM hub_devices WHERE id = ?').get(id)
  if (!device) return res.status(404).json({ error: 'not found' })

  db.prepare('UPDATE hub_devices SET revoked_at = ? WHERE id = ?').run(new Date().toISOString(), id)
  return res.json({ ok: true })
})

// GET /v1/devices — list devices (admin)
app.get('/v1/devices', (req, res) => {
  const secret = req.headers['x-hub-secret']
  if (secret !== HUB_SECRET) return res.status(401).json({ error: 'unauthorized' })

  const devices = db.prepare('SELECT id, name, role, revoked_at FROM hub_devices ORDER BY rowid DESC').all()
  return res.json({ devices })
})

// ── Cloud notification receiver ───────────────────────────────────────────────
app.post('/v1/notify', (req, res) => {
  const secret = req.headers['x-hub-secret']
  if (secret !== HUB_SECRET) return res.status(401).json({ error: 'unauthorized' })
  // Trigger immediate sync
  void syncUp()
  return res.json({ ok: true })
})

// ── Start server ──────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Hub listening on port ${PORT}`)

  // Initial sync on startup
  void syncDown().catch(err => console.error('Initial sync failed:', (err as Error).message))

  // Periodic sync
  const interval = parseInt(process.env['HUB_SYNC_INTERVAL_MS'] ?? '60000')
  setInterval(() => {
    void syncDown().catch(err => console.error('Sync down failed:', (err as Error).message))
    void syncUp().catch(err => console.error('Sync up failed:', (err as Error).message))
  }, interval)
})
