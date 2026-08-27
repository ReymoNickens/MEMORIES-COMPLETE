'use client'

import { useEffect, useState } from 'react'
import { createSupabaseClient } from '@/lib/supabase/client'

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

  useEffect(() => {
    const supabase = createSupabaseClient()

    // Load current queue on mount
    void supabase
      .from('orders')
      .select('id, created_at, station_label, venue_tables(label), order_items(id, product_name, quantity, status)')
      .eq('status', 'paid')
      .eq('station_label', STATION)
      .order('created_at')
      .then(({ data }) => {
        if (data) setOrders(data.map(mapOrder))
      })

    // Subscribe to new paid orders for this station
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

  function elapsedLabel(iso: string): string {
    const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
    if (secs < 60) return `${secs}s`
    return `${Math.floor(secs / 60)}m ${secs % 60}s`
  }

  return (
    <div className="min-h-screen bg-ev-bg p-4" data-tenant="memories-nc">
      <div className="text-center mb-4">
        <h1 className="text-h1 text-ev-accent">{STATION}</h1>
      </div>

      {orders.length === 0 && (
        <p className="text-body-md text-ev-secondary text-center mt-12">No pending orders</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-w-6xl mx-auto">
        {orders.map(order => {
          const allReady = order.items.every(i => i.status === 'ready' || i.status === 'delivered')
          return (
            <div
              key={order.id}
              className="rounded-lg border p-4"
              style={{ borderColor: allReady ? '#1A5C2E' : '#2A2D32', backgroundColor: '#121416' }}
            >
              <div className="flex items-start justify-between mb-3">
                <span className="text-[48px] font-bold text-ev-accent leading-none">{order.token}</span>
                <span className="text-micro text-ev-secondary">{elapsedLabel(order.created_at)}</span>
              </div>
              <p className="text-label text-ev-secondary mb-3">
                {order.table_label ?? order.station_label ?? '—'}
              </p>

              <div className="space-y-2">
                {order.items.map((item, idx) => (
                  <button
                    key={item.id}
                    onClick={() => item.status === 'pending' || item.status === 'preparing'
                      ? markItemReady(order.id, item.id)
                      : undefined
                    }
                    className="w-full px-3 py-3 rounded border text-left transition-colors min-h-tap"
                    style={{
                      borderColor: item.status === 'ready' || item.status === 'delivered' ? '#1A5C2E' : '#C8CCD4',
                      color: item.status === 'ready' || item.status === 'delivered' ? '#1A5C2E' : '#C8CCD4',
                      backgroundColor: item.status === 'ready' || item.status === 'delivered' ? '#EBF5EE22' : 'transparent',
                    }}
                  >
                    <span className="font-bold">{item.quantity}×</span> {item.product_name}
                    <span className="float-right text-label uppercase">
                      {item.status === 'ready' || item.status === 'delivered' ? 'DONE' : 'READY?'}
                    </span>
                  </button>
                ))}
              </div>

              {allReady && (
                <div className="mt-3 text-center text-label text-ev-success font-semibold uppercase tracking-wide">
                  All Ready
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
