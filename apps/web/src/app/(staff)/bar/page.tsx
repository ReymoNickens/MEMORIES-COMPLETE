'use client'

import { useCallback, useEffect, useState } from 'react'
import { FloorShell, ageTone } from '@/components/FloorShell'

interface RailItem {
  id: string
  product_name: string
  quantity: number
  status: string
}

interface RailOrder {
  id: string
  token: string
  since: string
  guest_name: string
  table_label: string | null
  station_label: string | null
  items: RailItem[]
}

export default function BarDisplayPage() {
  const [orders, setOrders] = useState<RailOrder[]>([])
  const [station, setStation] = useState<string>('')
  const [noShift, setNoShift] = useState(false)
  const [clock, setClock] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  // The old page read the station from localStorage at module scope, which
  // meant it was fixed at first import, mismatched between server and client
  // render, and had no way to be set — so every bar in the venue answered to
  // "Bar Main" and Bar VIP never saw a ticket. The station now comes from the
  // station the staff member claimed at sign-in.
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/rail?kind=bar', { cache: 'no-store' })
      if (res.status === 401) { window.location.href = '/staff/login'; return }
      const data = await res.json() as {
        station?: string; orders?: RailOrder[]; no_shift?: boolean; error?: string
      }
      if (data.error) { setError(data.error); return }
      setError('')
      setStation(data.station ?? '')
      setNoShift(!!data.no_shift)
      setOrders(data.orders ?? [])
    } catch {
      setError('Lost the network. Showing the last known rail.')
    }
  }, [])

  useEffect(() => {
    void load()
    // A bar display is a wall-mounted screen nobody touches. Poll rather than
    // hold a realtime socket open all night behind venue wifi that drops.
    const poll = setInterval(() => void load(), 4000)
    const tick = setInterval(() => {
      setClock(new Date().toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' }))
    }, 1000)
    return () => { clearInterval(poll); clearInterval(tick) }
  }, [load])

  async function advance(item: RailItem) {
    const next = item.status === 'pending' ? 'preparing' : item.status === 'preparing' ? 'ready' : null
    if (!next || busy) return
    setBusy(item.id)
    // Optimistic: a bartender with wet hands should not wait on a round trip.
    setOrders(prev => prev.map(o => ({
      ...o, items: o.items.map(i => i.id === item.id ? { ...i, status: next } : i),
    })))
    const res = await fetch('/api/orders/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: item.id, status: next }),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({})) as { error?: string }
      setError(d.error ?? 'Could not update that line.')
    }
    setBusy(null)
    void load()
  }

  const label = (s: string) => (s === 'pending' ? 'Fire' : s === 'preparing' ? 'Pouring' : 'Up')

  return (
    <FloorShell station={station || 'Bar'} clock={clock}>
      {error && (
        <p className="border-b border-ev-crimson/40 bg-ev-crimson/10 px-5 py-2 text-[12px] text-[#F0B7BF]">
          {error}
        </p>
      )}

      <div className="p-4">
        {noShift && (
          <p className="mt-16 text-center text-[14px] text-[#8A8580]">
            No shift is open. The rail starts when the manager opens the night.
          </p>
        )}

        {!noShift && orders.length === 0 && (
          <p className="mt-16 text-center text-[14px] text-[#8A8580]">No tickets on the rail.</p>
        )}

        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {orders.map(order => {
            const live = order.items.filter(i => i.status !== 'delivered')
            const allUp = live.length > 0 && live.every(i => i.status === 'ready')
            const age = ageTone(order.since)
            return (
              <article
                key={order.id}
                className="border p-4"
                style={{
                  borderColor: allUp ? '#1A5C2E' : age.late ? '#B8122A' : '#2A242C',
                  backgroundColor: '#100E14',
                }}
              >
                <div className="mb-3 flex items-start justify-between">
                  <span className="font-display text-[48px] leading-none">{order.token}</span>
                  <span className={`font-mono text-[13px] ${age.className}`}>{age.label}</span>
                </div>
                <p className="mb-3 text-[11px] uppercase tracking-[0.2em] text-[#8A8580]">
                  {order.table_label ?? order.station_label ?? 'Walk-up'}
                  <span className="text-[#6B6570]"> · {order.guest_name}</span>
                </p>
                <div className="space-y-2">
                  {live.map(item => {
                    const done = item.status === 'ready'
                    return (
                      <button
                        key={item.id}
                        onClick={() => void advance(item)}
                        disabled={done || busy === item.id}
                        className="min-h-tap w-full border px-3 py-3 text-left disabled:opacity-70"
                        style={{
                          borderColor: done ? '#1A5C2E' : '#2A242C',
                          color: done ? '#7DCF8A' : '#F3EDE4',
                        }}
                      >
                        <span className="font-bold">{item.quantity}×</span> {item.product_name}
                        <span className="float-right text-[11px] uppercase tracking-[0.16em]">
                          {label(item.status)}
                        </span>
                      </button>
                    )
                  })}
                </div>
                {allUp && (
                  <p className="mt-3 text-center text-[11px] font-semibold uppercase tracking-[0.2em] text-[#7DCF8A]">
                    All up — call the runner
                  </p>
                )}
              </article>
            )
          })}
        </div>
      </div>
    </FloorShell>
  )
}
