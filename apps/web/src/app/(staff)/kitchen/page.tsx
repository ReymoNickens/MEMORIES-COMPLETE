'use client'

import { useCallback, useEffect, useState } from 'react'
import { FloorShell, ageTone } from '@/components/FloorShell'

interface Item { id: string; product_name: string; quantity: number; status: string }
interface Order {
  id: string
  token: string
  since: string
  guest_name: string
  table_label: string | null
  items: Item[]
}

export default function KitchenPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [clock, setClock] = useState('')
  const [noShift, setNoShift] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/rail?kind=kitchen', { cache: 'no-store' })
      if (res.status === 401) { window.location.href = '/staff/login'; return }
      const data = await res.json() as { orders?: Order[]; no_shift?: boolean; error?: string }
      if (data.error) { setError(data.error); return }
      setError('')
      setNoShift(!!data.no_shift)
      setOrders(data.orders ?? [])
    } catch {
      setError('Lost the network. Showing the last known pass.')
    }
  }, [])

  useEffect(() => {
    void load()
    const poll = setInterval(() => void load(), 4000)
    const tick = setInterval(() => {
      setClock(new Date().toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' }))
    }, 1000)
    return () => { clearInterval(poll); clearInterval(tick) }
  }, [load])

  async function advance(item: Item) {
    const next = item.status === 'pending' ? 'preparing' : 'ready'
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
    void load()
  }

  return (
    <FloorShell station="Kitchen" clock={clock}>
      {error && (
        <p className="border-b border-ev-crimson/40 bg-ev-crimson/10 px-5 py-2 text-[12px] text-[#F0B7BF]">
          {error}
        </p>
      )}
      <main className="p-4">
        {noShift && (
          <p className="mt-16 text-center text-[14px] text-[#8A8580]">
            No shift is open. Nothing reaches the pass until the night starts.
          </p>
        )}
        {!noShift && orders.length === 0 && (
          <p className="mt-16 text-center text-[14px] text-[#8A8580]">The pass is clear.</p>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          {orders.map(o => {
            const age = ageTone(o.since)
            const live = o.items.filter(i => i.status !== 'delivered')
            return (
              <article
                key={o.id}
                className="border bg-[#100E14] p-4"
                style={{ borderColor: age.late ? '#B8122A' : '#2A242C' }}
              >
                <div className="mb-3 flex items-start justify-between">
                  <span className="font-display text-[48px] leading-none">{o.token}</span>
                  <span className={`font-mono text-[13px] ${age.className}`}>{age.label}</span>
                </div>
                <p className="mb-3 text-[11px] uppercase tracking-[0.2em] text-[#8A8580]">
                  {o.table_label ?? 'Counter'}<span className="text-[#6B6570]"> · {o.guest_name}</span>
                </p>
                {live.map(i => (
                  <button
                    key={i.id}
                    onClick={() => void advance(i)}
                    disabled={i.status === 'ready'}
                    className="mb-2 flex min-h-12 w-full items-center justify-between border px-3 py-3 text-left disabled:opacity-70"
                    style={{ borderColor: i.status === 'ready' ? '#1A5C2E' : '#2A242C' }}
                  >
                    <span><span className="font-semibold">{i.quantity}×</span> {i.product_name}</span>
                    <span
                      className="text-[11px] uppercase tracking-[0.16em]"
                      style={{ color: i.status === 'ready' ? '#7DCF8A' : '#B8122A' }}
                    >
                      {i.status === 'pending' ? 'Fire' : i.status === 'preparing' ? 'Pass' : 'Up'}
                    </span>
                  </button>
                ))}
              </article>
            )
          })}
        </div>
      </main>
    </FloorShell>
  )
}
