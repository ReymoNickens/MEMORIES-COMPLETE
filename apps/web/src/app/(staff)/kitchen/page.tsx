'use client'
import { useEffect, useState } from 'react'
import { createSupabaseClient } from '@/lib/supabase/client'

interface Item { id: string; product_name: string; quantity: number; status: string; station: string }
interface Order { id: string; created_at: string; items: Item[] }

function buildOrder(rows: Array<Record<string, unknown>>): Map<string, Order> {
  const grouped = new Map<string, Order>()
  for (const row of rows) {
    const ordArr = (row as { orders: { id: string; created_at: string } | { id: string; created_at: string }[] }).orders
    const ord = Array.isArray(ordArr) ? ordArr[0] : ordArr
    if (!ord) continue
    const cur = grouped.get(ord.id) ?? { id: ord.id, created_at: ord.created_at, items: [] }
    cur.items.push(row as unknown as Item)
    grouped.set(ord.id, cur)
  }
  return grouped
}

export default function KitchenPage() {
  const [orders, setOrders] = useState<Order[]>([])

  useEffect(() => {
    const supabase = createSupabaseClient()

    void supabase
      .from('order_items')
      .select('id, product_name, quantity, status, station, order_id, orders(id, created_at, status)')
      .eq('station', 'kitchen')
      .in('status', ['pending', 'preparing'])
      .order('created_at')
      .then(({ data }) => setOrders([...buildOrder(data ?? []).values()]))

    const channel = supabase
      .channel('kitchen-display')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'order_items', filter: 'station=eq.kitchen' },
        async payload => {
          const item = payload.new as { id: string; order_id: string; status: string }
          if (item.status !== 'pending') return
          const { data } = await supabase
            .from('order_items')
            .select('id, product_name, quantity, status, station, order_id, orders(id, created_at, status)')
            .eq('id', item.id)
            .single()
          if (!data) return
          setOrders(prev => {
            const ordRaw = data.orders
            const ord = (Array.isArray(ordRaw) ? ordRaw[0] : ordRaw) as { id: string; created_at: string } | null
            if (!ord) return prev
            const existing = prev.find(o => o.id === ord.id)
            if (existing) {
              return prev.map(o => o.id === ord.id ? { ...o, items: [...o.items, data as unknown as Item] } : o)
            }
            return [...prev, { id: ord.id, created_at: ord.created_at, items: [data as unknown as Item] }]
          })
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'order_items', filter: 'station=eq.kitchen' },
        payload => {
          const item = payload.new as { id: string; status: string }
          if (item.status === 'ready' || item.status === 'delivered' || item.status === 'voided') {
            // Remove completed items; drop the order if all done
            setOrders(prev => prev
              .map(o => ({ ...o, items: o.items.map(i => i.id === item.id ? { ...i, status: item.status } : i) }))
              .filter(o => o.items.some(i => i.status === 'pending' || i.status === 'preparing'))
            )
          } else {
            setOrders(prev => prev.map(o => ({
              ...o,
              items: o.items.map(i => i.id === item.id ? { ...i, status: item.status } : i),
            })))
          }
        }
      )
      .subscribe()

    return () => { void supabase.removeChannel(channel) }
  }, [])

  async function mark(itemId: string, currentStatus: string) {
    const next = currentStatus === 'pending' ? 'preparing' : 'ready'
    await fetch('/api/orders/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemId, status: next }),
    })
  }

  return (
    <main className="min-h-screen bg-ev-page p-4">
      <h1 className="font-display text-h1 mb-4">Kitchen</h1>
      {orders.length === 0 && <p className="text-ev-muted text-body-md mt-12 text-center">Queue is clear</p>}
      <div className="grid md:grid-cols-2 gap-3">
        {orders.map(o => (
          <article key={o.id} className="bg-white rounded-xl border p-4">
            <p className="text-micro text-ev-muted">{new Date(o.created_at).toLocaleTimeString()}</p>
            {o.items.map(i => (
              <div key={i.id} className="flex justify-between items-center py-2 border-b last:border-0">
                <span>{i.quantity}× {i.product_name}</span>
                <button
                  onClick={() => void mark(i.id, i.status)}
                  className="h-10 px-3 rounded bg-ev-navy text-white text-micro"
                >
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
