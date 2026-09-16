'use client'

import { useEffect, useState } from 'react'
import { subscribe, wireAutoSync, retry, discard, type QueuedOrder } from '@/lib/offline-order-queue'

// Visible sync state for queued cash orders — never a silent queue. Shown
// wherever an order can be placed (the menu/table-QR screen) so a waiter
// working a bad connection can see what's still pending and what needs
// their attention.
export function OfflineQueueBadge() {
  const [orders, setOrders] = useState<QueuedOrder[]>([])
  const [online, setOnline] = useState(true)

  useEffect(() => {
    wireAutoSync()
    const unsubscribe = subscribe(setOrders)
    setOnline(navigator.onLine)
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      unsubscribe()
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  if (orders.length === 0 && online) return null

  const failed = orders.filter(o => o.status === 'failed')
  const pending = orders.filter(o => o.status !== 'failed')

  return (
    <div className="fixed bottom-24 left-4 right-4 z-40 mx-auto max-w-lg space-y-2">
      {!online && (
        <div className="rounded-lg border border-[#E0A24A] bg-[#100E14] px-4 py-2 text-[12px] text-[#E0A24A]">
          Offline — orders will send the moment the connection returns.
        </div>
      )}
      {pending.length > 0 && (
        <div className="rounded-lg border border-ev-border bg-[#100E14] px-4 py-2 text-[12px] text-[#C4B8A8]">
          {pending.some(o => o.status === 'syncing') ? 'Syncing' : 'Queued'} — {pending.length} order{pending.length !== 1 ? 's' : ''} waiting to send.
        </div>
      )}
      {failed.map(o => (
        <div key={o.client_order_id} className="rounded-lg border border-ev-crimson bg-[#100E14] px-4 py-2 text-[12px] text-[#F3EDE4]">
          <p>{o.guest_name}'s order was rejected: {o.error}</p>
          <div className="mt-2 flex gap-3">
            <button onClick={() => void retry(o.client_order_id)} className="underline">Retry</button>
            <button onClick={() => void discard(o.client_order_id)} className="underline text-ev-muted">Discard</button>
          </div>
        </div>
      ))}
    </div>
  )
}
