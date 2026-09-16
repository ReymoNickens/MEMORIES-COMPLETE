'use client'

// Offline order queue for the waitstaff-on-a-bad-connection case (Section 7
// of the build brief). Cash orders placed from the table-QR/menu screen
// while offline are stored here and retried once the connection returns.
// This is browser-side state only — separate from the door hub's SQLite
// offline system, which is a trusted fixed device with a different threat
// model. Money-side idempotency (a retry never creates a second order) is
// enforced server-side by place_order's local_ref check
// (024_offline_order_queue.sql) — this module is the client half: it must
// carry the same client_order_id on every retry of the same order.

export interface QueuedOrder {
  client_order_id: string
  token: string
  items: Array<{ product_id: string; quantity: number }>
  guest_name: string
  guest_phone: string
  queued_at: number
  status: 'queued' | 'syncing' | 'failed'
  error?: string
  attempts: number
}

const DB_NAME = 'mnc-offline-orders'
const STORE = 'orders'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'client_order_id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const req = fn(tx.objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    tx.oncomplete = () => db.close()
  })
}

type Listener = (orders: QueuedOrder[]) => void
const listeners = new Set<Listener>()

async function notify() {
  const all = await listAll()
  listeners.forEach(l => l(all))
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  void listAll().then(listener)
  return () => listeners.delete(listener)
}

export async function listAll(): Promise<QueuedOrder[]> {
  const all = await withStore<QueuedOrder[]>('readonly', store => store.getAll())
  return all.sort((a, b) => a.queued_at - b.queued_at)
}

export async function enqueue(order: Omit<QueuedOrder, 'queued_at' | 'status' | 'attempts'>): Promise<void> {
  const record: QueuedOrder = { ...order, queued_at: Date.now(), status: 'queued', attempts: 0 }
  await withStore('readwrite', store => store.put(record))
  await notify()
}

async function remove(clientOrderId: string): Promise<void> {
  await withStore('readwrite', store => store.delete(clientOrderId))
  await notify()
}

async function update(order: QueuedOrder): Promise<void> {
  await withStore('readwrite', store => store.put(order))
  await notify()
}

let draining = false

// Sends every queued order, one at a time — a just-reconnected phone on a
// weak signal shouldn't fire a burst of simultaneous requests. A network
// failure leaves the order queued for the next drain (triggered by the
// `online` event or the next call); a server-side rejection (sold out, a
// validation error) is not retried automatically — it's marked failed so
// staff can see and act on it, rather than looping forever on something a
// retry can never fix.
export async function drain(): Promise<void> {
  if (draining) return
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  draining = true
  try {
    const orders = await listAll()
    for (const order of orders) {
      if (order.status === 'failed') continue
      await update({ ...order, status: 'syncing' })
      try {
        const res = await fetch('/api/orders/initiate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: order.token,
            items: order.items,
            guest_name: order.guest_name,
            guest_phone: order.guest_phone,
            payment_source: 'cash',
            client_order_id: order.client_order_id,
          }),
        })
        if (res.ok) {
          await remove(order.client_order_id)
        } else {
          const j = await res.json().catch(() => null) as { error?: string } | null
          await update({ ...order, status: 'failed', error: j?.error ?? 'Rejected by the server', attempts: order.attempts + 1 })
        }
      } catch {
        // Offline again mid-drain — leave it queued, try again next time.
        await update({ ...order, status: 'queued', attempts: order.attempts + 1 })
        break
      }
    }
  } finally {
    draining = false
  }
}

export async function retry(clientOrderId: string): Promise<void> {
  const orders = await listAll()
  const order = orders.find(o => o.client_order_id === clientOrderId)
  if (!order) return
  const { error: _error, ...rest } = order
  await update({ ...rest, status: 'queued' })
  await drain()
}

export async function discard(clientOrderId: string): Promise<void> {
  await remove(clientOrderId)
}

let wired = false
export function wireAutoSync(): void {
  if (wired || typeof window === 'undefined') return
  wired = true
  window.addEventListener('online', () => void drain())
  // A fallback in case the `online` event is missed (some mobile browsers
  // fire it unreliably coming out of a long offline stretch).
  setInterval(() => void drain(), 15_000)
  void drain()
}
