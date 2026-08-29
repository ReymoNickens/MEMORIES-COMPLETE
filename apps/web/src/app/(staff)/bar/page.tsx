'use client'

import { useEffect, useState } from 'react'
import { createSupabaseClient } from '@/lib/supabase/client'
import { FloorShell, ageTone } from '@/components/FloorShell'

interface OrderItem {
  id: string
  product_name: string
  quantity: number
  status: string
}

interface OrderCard {
  id: string
  token: string
  created_at: string
  station_label: string | null
  table_label: string | null
  items: OrderItem[]
}

const STATION = typeof window !== 'undefined' ? (localStorage.getItem('station') ?? 'Bar Main') : 'Bar Main'

export default function BarDisplayPage() {
  const [orders, setOrders] = useState<OrderCard[]>([])
  const [clock, setClock] = useState('')

  useEffect(() => {
    const t = setInterval(() => {
      setClock(new Date().toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' }))
    }, 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const supabase = createSupabaseClient()

    void supabase
      .from('orders')
      .select('id, created_at, station_label, venue_tables(label), order_items(id, product_name, quantity, status)')
      .eq('status', 'paid')
      .eq('station_label', STATION)
      .order('created_at')
      .then(({ data }) => {
        if (data) setOrders(data.map(mapOrder))
      })

    const channel = supabase
      .channel('bar-display')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'orders', filter: `station_label=eq.${STATION}` },
        payload => {
          const order = payload.new as Record<string, unknown>
          if (order['status'] === 'paid') {
            void supabase
              .from('orders')
              .select('id, created_at, station_label, venue_tables(label), order_items(id, product_name, quantity, status)')
              .eq('id', order['id'])
              .single()
              .then(({ data }) => {
                if (data) setOrders(prev => [...prev, mapOrder(data)])
              })
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'order_items' },
        payload => {
          const item = payload.new as { id: string; status: string }
          setOrders(prev => prev.map(o => ({
            ...o,
            items: o.items.map(i => i.id === item.id ? { ...i, status: item.status } : i),
          })))
        }
      )
      .subscribe()

    return () => { void supabase.removeChannel(channel) }
  }, [])

  function mapOrder(data: Record<string, unknown>): OrderCard {
    const venueTable = data['venue_tables'] as { label: string } | null
    return {
      id: data['id'] as string,
      token: (data['id'] as string).slice(-4).toUpperCase(),
      created_at: data['created_at'] as string,
      station_label: data['station_label'] as string | null,
      table_label: venueTable?.label ?? null,
      items: ((data['order_items'] as OrderItem[] | null) ?? []),
    }
  }

  async function markItemReady(orderId: string, itemId: string) {
    const supabase = createSupabaseClient()
    await supabase
      .from('order_items')
      .update({ status: 'ready', ready_at: new Date().toISOString() })
      .eq('id', itemId)
  }

  return (
    <FloorShell station={STATION} clock={clock}>
      <div className="p-4">
        {orders.length === 0 && (
          <p className="mt-16 text-center text-[14px] text-[#8A8580]">No tickets on the rail.</p>
        )}
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {orders.map(order => {
            const allReady = order.items.every(i => i.status === 'ready' || i.status === 'delivered')
            const age = ageTone(order.created_at)
            return (
              <div
                key={order.id}
                className="border p-4"
                style={{ borderColor: allReady ? '#1A5C2E' : '#2A242C', backgroundColor: '#100E14' }}
              >
                <div className="mb-3 flex items-start justify-between">
                  <span className="font-display text-[48px] leading-none">{order.token}</span>
                  <span className={`font-mono text-[13px] ${age.className}`}>{age.label}</span>
                </div>
                <p className="mb-3 text-[11px] uppercase tracking-[0.2em] text-[#8A8580]">
                  {order.table_label ?? order.station_label ?? 'Walk-up'}
                </p>
                <div className="space-y-2">
                  {order.items.map(item => (
                    <button
                      key={item.id}
                      onClick={() => item.status === 'pending' || item.status === 'preparing'
                        ? void markItemReady(order.id, item.id)
                        : undefined
                      }
                      className="min-h-tap w-full border px-3 py-3 text-left"
                      style={{
                        borderColor: item.status === 'ready' || item.status === 'delivered' ? '#1A5C2E' : '#2A242C',
                        color: item.status === 'ready' || item.status === 'delivered' ? '#7DCF8A' : '#F3EDE4',
                      }}
                    >
                      <span className="font-bold">{item.quantity}\u00d7</span> {item.product_name}
                      <span className="float-right text-[11px] uppercase tracking-[0.16em]">
                        {item.status === 'ready' || item.status === 'delivered' ? 'Up' : 'Ready'}
                      </span>
                    </button>
                  ))}
                </div>
                {allReady && (
                  <div className="mt-3 text-center text-[11px] font-semibold uppercase tracking-[0.2em] text-[#7DCF8A]">
                    All up
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </FloorShell>
  )
}
