'use client'
import { useEffect, useState } from 'react'
import { createSupabaseClient } from '@/lib/supabase/client'
import { FloorShell, ageTone } from '@/components/FloorShell'

interface Item { id: string; product_name: string; quantity: number; status: string; station: string }
interface Order { id: string; created_at: string; items: Item[] }

export default function KitchenPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [clock, setClock] = useState('')

  async function reload() {
    const supabase = createSupabaseClient()
    const { data } = await supabase
      .from('order_items')
      .select('id, product_name, quantity, status, station, order_id, orders(id, created_at, status)')
      .eq('station', 'kitchen')
      .in('status', ['pending', 'preparing'])
      .order('created_at')
    const grouped = new Map<string, Order>()
    for (const row of data ?? []) {
      const ord = (row as { orders: { id: string; created_at: string } }).orders
      if (!ord) continue
      const cur = grouped.get(ord.id) ?? { id: ord.id, created_at: ord.created_at, items: [] }
      cur.items.push(row as Item)
      grouped.set(ord.id, cur)
    }
    setOrders([...grouped.values()])
  }

  useEffect(() => {
    void reload()
    const t = setInterval(() => {
      setClock(new Date().toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' }))
    }, 1000)
    return () => clearInterval(t)
  }, [])

  async function mark(itemId: string, status: string) {
    await fetch('/api/orders/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item_id: itemId, status }) })
    void reload()
  }

  return (
    <FloorShell station="Kitchen" clock={clock}>
      <main className="p-4">
        {orders.length === 0 && (
          <p className="mt-16 text-center text-[14px] text-[#8A8580]">The pass is clear.</p>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          {orders.map(o => {
            const age = ageTone(o.created_at)
            const token = o.id.slice(-4).toUpperCase()
            return (
              <article key={o.id} className="border border-[#2A242C] bg-[#100E14] p-4">
                <div className="mb-4 flex items-start justify-between">
                  <span className="font-display text-[48px] leading-none">{token}</span>
                  <span className={`font-mono text-[13px] ${age.className}`}>{age.label}</span>
                </div>
                {o.items.map(i => (
                  <button
                    key={i.id}
                    onClick={() => void mark(i.id, i.status === 'pending' ? 'preparing' : 'ready')}
                    className="mb-2 flex min-h-12 w-full items-center justify-between border border-[#2A242C] px-3 py-3 text-left"
                  >
                    <span><span className="font-semibold">{i.quantity}\u00d7</span> {i.product_name}</span>
                    <span className="text-[11px] uppercase tracking-[0.16em] text-ev-crimson">
                      {i.status === 'pending' ? 'Fire' : 'Pass'}
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
