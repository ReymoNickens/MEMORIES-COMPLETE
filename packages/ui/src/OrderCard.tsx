import React from 'react'

export interface OrderCardProps {
  order: {
    token: string
    created_at: string
    station_label: string
    items: Array<{ name: string; quantity: number; status: string }>
  }
  onItemReady: (item_index: number) => void
}

function elapsed(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m`
}

export function OrderCard({ order, onItemReady }: OrderCardProps) {
  const allReady = order.items.every(i => i.status === 'ready' || i.status === 'delivered')

  return (
    <div
      className="rounded-lg border p-4"
      style={{
        borderColor: allReady ? '#1A5C2E' : '#2A2D32',
        backgroundColor: '#121416',
      }}
    >
      <div className="flex items-start justify-between mb-3">
        <span className="text-[48px] font-bold text-[#C8CCD4] leading-none">{order.token}</span>
        <span className="text-[12px] text-[#9A9E9F]">{elapsed(order.created_at)}</span>
      </div>
      <p className="text-[14px] text-[#9A9E9F] mb-3">{order.station_label}</p>

      <div className="space-y-2">
        {order.items.map((item, idx) => {
          const done = item.status === 'ready' || item.status === 'delivered'
          return (
            <button
              key={idx}
              onClick={() => !done && onItemReady(idx)}
              className="w-full px-3 py-3 rounded border text-left transition-colors"
              style={{
                borderColor: done ? '#1A5C2E' : '#C8CCD4',
                color: done ? '#1A5C2E' : '#C8CCD4',
                backgroundColor: done ? '#EBF5EE22' : 'transparent',
                minHeight: '48px',
              }}
            >
              <span className="font-bold">{item.quantity}×</span> {item.name}
              <span className="float-right text-[12px] uppercase font-semibold">
                {done ? 'DONE' : 'READY'}
              </span>
            </button>
          )
        })}
      </div>

      {allReady && (
        <div className="mt-3 text-center text-[12px] text-[#1A5C2E] font-semibold uppercase tracking-widest">
          All Ready
        </div>
      )}
    </div>
  )
}
