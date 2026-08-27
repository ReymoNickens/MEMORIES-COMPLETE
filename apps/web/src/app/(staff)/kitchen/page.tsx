'use client'
import { useEffect, useState } from 'react'
import { createSupabaseClient } from '@/lib/supabase/client'

interface Item { id: string; product_name: string; quantity: number; status: string; station: string }
interface Order { id: string; created_at: string; items: Item[] }

export default function KitchenPage() {
  const [orders, setOrders] = useState<Order[]>([])

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
      const ordArr = (row as { orders: { id: string; created_at: string; status: string }[] }).orders
      const ord = Array.isArray(ordArr) ? ordArr[0] : (ordArr as unknown as { id: string; created_at: string; status: string })
      if (!ord) continue
      const cur = grouped.get(ord.id) ?? { id: ord.id, created_at: ord.created_at, items: [] }
      cur.items.push(row as Item)
      grouped.set(ord.id, cur)
    }
    setOrders([...grouped.values()])
  }

  useEffect(() => { void reload() }, [])

  async function mark(itemId: string, status: string) {
    await fetch('/api/orders/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item_id: itemId, status }) })
    void reload()
  }

  return (
    <main className="min-h-screen bg-ev-page p-4">
      <h1 className="font-display text-h1 mb-4">Kitchen</h1>
      <div className="grid md:grid-cols-2 gap-3">
        {orders.map(o => (
          <article key={o.id} className="bg-white rounded-xl border p-4">
            <p className="text-micro text-ev-muted">{new Date(o.created_at).toLocaleTimeString()}</p>
            {o.items.map(i => (
              <div key={i.id} className="flex justify-between items-center py-2 border-b last:border-0">
                <span>{i.quantity}× {i.product_name}</span>
                <button onClick={() => void mark(i.id, i.status === 'pending' ? 'preparing' : 'ready')} className="h-10 px-3 rounded bg-ev-navy text-white text-micro">
                  {i.status === 'pending' ? 'Start' : 'Ready'}
                </button>
              </div>
            ))}
          </article>
        ))}
      </div>
    </main>
  )
}
