'use client'

import { useCallback, useEffect, useState } from 'react'
import { formatAmount } from '@evolveit/shared/money'
import { FloorShell, ageTone } from '@/components/FloorShell'

interface OrderItem { id: string; product_name: string; quantity: number; status: string }
interface Order {
  id: string
  venue_table_id: string | null
  amount_pesewas: number
  payment_source: string
  status: string
  created_at: string
  paid_at: string | null
  guest_name: string
  order_items: OrderItem[]
}
interface Table {
  id: string
  label: string
  zone: string
  seats: number
  min_spend_pesewas: number
}
interface Cash {
  owed_pesewas: number
  order_count: number
  counted: boolean
  counted_pesewas: number | null
}

export default function WaiterPage() {
  const [tables, setTables] = useState<Table[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [cash, setCash] = useState<Cash | null>(null)
  const [noShift, setNoShift] = useState(false)
  const [open, setOpen] = useState<Table | null>(null)
  const [clock, setClock] = useState('')

  const load = useCallback(async () => {
    const res = await fetch('/api/waiter', { cache: 'no-store' })
    if (res.status === 401) { window.location.href = '/staff/login'; return }
    const d = await res.json() as {
      tables?: Table[]; orders?: Order[]; cash?: Cash; no_shift?: boolean
    }
    setTables(d.tables ?? [])
    setOrders(d.orders ?? [])
    setCash(d.cash ?? null)
    setNoShift(!!d.no_shift)
  }, [])

  useEffect(() => {
    void load()
    const poll = setInterval(() => void load(), 5000)
    const tick = setInterval(() => {
      setClock(new Date().toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' }))
    }, 1000)
    return () => { clearInterval(poll); clearInterval(tick) }
  }, [load])

  function forTable(id: string) {
    return orders.filter(o => o.venue_table_id === id)
  }

  /**
   * Three states, and they mean different things to a server crossing a dark
   * room: nothing running, something waiting at the bar, or everything down
   * and the table is drinking. The old page called these empty / pending /
   * done, which told you about the data rather than about the table.
   */
  function state(id: string): { key: string; label: string; border: string; bg: string } {
    const live = forTable(id).filter(o => o.status !== 'complete')
    if (live.length === 0) return { key: 'clear', label: 'Clear', border: '#2A242C', bg: '#100E14' }
    const waiting = live.some(o => o.order_items.some(i => i.status === 'pending' || i.status === 'preparing'))
    if (waiting) return { key: 'waiting', label: 'At the bar', border: '#E0A24A', bg: '#2A1F0C' }
    return { key: 'served', label: 'Served', border: '#1A5C2E', bg: '#0C1E12' }
  }

  const spend = (id: string) =>
    forTable(id).reduce((s, o) => s + Number(o.amount_pesewas), 0)

  return (
    <FloorShell station="My section" clock={clock}>
      <main className="px-4 pb-24 pt-4">
        {noShift && (
          <p className="mt-16 text-center text-[14px] text-[#8A8580]">
            No shift is open yet.
          </p>
        )}

        <div className="mx-auto grid max-w-lg grid-cols-2 gap-3 sm:grid-cols-3">
          {tables.map(t => {
            const st = state(t.id)
            const spent = spend(t.id)
            const short = t.min_spend_pesewas > 0 && spent < t.min_spend_pesewas
            return (
              <button
                key={t.id}
                onClick={() => setOpen(t)}
                className="border p-3 text-left"
                style={{ borderColor: st.border, background: st.bg }}
              >
                <p className="font-display text-[20px] leading-none">{t.label}</p>
                <p className="mt-2 text-[10px] uppercase tracking-[0.18em] text-[#C4B8A8]">{st.label}</p>
                <p className="mt-2 font-mono text-[13px]">{formatAmount(spent)}</p>
                {/* Min spend is the floor manager's whole job and the schema has
                    carried it since 003, but no screen had ever shown it. */}
                {t.min_spend_pesewas > 0 && (
                  <p className={`mt-1 text-[10px] uppercase tracking-[0.14em] ${short ? 'text-[#E0A24A]' : 'text-[#7DCF8A]'}`}>
                    {short
                      ? `${formatAmount(t.min_spend_pesewas - spent)} to min`
                      : 'Min met'}
                  </p>
                )}
              </button>
            )
          })}
        </div>

        {/* What the server owes the house. Read-only: a server who can type
            their own hand-in number is not being reconciled. */}
        {cash && (
          <section className="mx-auto mt-8 max-w-lg border border-[#2A242C] bg-[#100E14] p-4">
            <p className="text-[11px] uppercase tracking-[0.22em] text-[#8A8580]">Cash in your apron</p>
            <p className="mt-2 font-mono text-[32px] text-[#F3EDE4]">{formatAmount(cash.owed_pesewas)}</p>
            <p className="mt-1 text-[12px] text-[#8A8580]">
              {cash.order_count} cash order{cash.order_count === 1 ? '' : 's'} tonight.
            </p>
            <p className="mt-3 border-t border-[#2A242C] pt-3 text-[12px] text-[#8A8580]">
              {cash.counted
                ? `Counted in at ${formatAmount(cash.counted_pesewas ?? 0)} by the duty manager.`
                : 'A manager counts you down at the end of the night. Do not leave without it.'}
            </p>
          </section>
        )}
      </main>

      {open && (
        <div className="fixed inset-0 z-10 bg-black/70" onClick={() => setOpen(null)}>
          <div
            className="absolute bottom-0 left-0 right-0 max-h-[80vh] overflow-y-auto border-t border-[#2A242C] bg-[#100E14] p-5"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-baseline justify-between">
              <h2 className="font-display text-[28px]">{open.label}</h2>
              <span className="text-[11px] uppercase tracking-[0.2em] text-[#8A8580]">
                {open.zone.replace('_', ' ')} · {open.seats} seats
              </span>
            </div>

            {forTable(open.id).length === 0 && (
              <p className="mt-6 text-[14px] text-[#8A8580]">Nothing running on this table.</p>
            )}

            {forTable(open.id).map(o => {
              const age = ageTone(o.paid_at ?? o.created_at)
              return (
                <div key={o.id} className="mt-4 border border-[#2A242C] p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] uppercase tracking-[0.18em] text-[#8A8580]">
                      {o.status === 'on_tab' ? 'Open tab' : o.payment_source} · {o.status}
                    </span>
                    <span className={`font-mono text-[12px] ${age.className}`}>{age.label}</span>
                  </div>
                  {o.order_items.map(i => (
                    <div key={i.id} className="flex justify-between py-1 text-[14px]">
                      <span>{i.quantity}× {i.product_name}</span>
                      <span
                        className="text-[11px] uppercase tracking-[0.14em]"
                        style={{ color: i.status === 'ready' ? '#7DCF8A' : i.status === 'delivered' ? '#6B6570' : '#E0A24A' }}
                      >
                        {i.status === 'ready' ? 'Collect' : i.status}
                      </span>
                    </div>
                  ))}
                  <p className="mt-2 border-t border-[#2A242C] pt-2 text-right font-mono text-[16px]">
                    {formatAmount(o.amount_pesewas)}
                  </p>
                </div>
              )
            })}

            <button
              onClick={() => setOpen(null)}
              className="mt-6 h-12 w-full border border-[#2A242C] text-[12px] uppercase tracking-[0.2em] text-[#C4B8A8]"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </FloorShell>
  )
}
