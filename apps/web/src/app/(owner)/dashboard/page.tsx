'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { formatAmount } from '@evolveit/shared/money'
import { Wordmark } from '@/components/Wordmark'

interface Dashboard {
  ok: boolean
  opened_at: string
  closed_at: string | null
  night: { gate_pesewas: number; fb_pesewas: number; gross_pesewas: number }
  ledger: {
    ticket_revenue: number; fb_revenue: number; momo_gross: number
    cash_gross: number; fees: number; comps: number; refunds: number
    cash_variance: number
  }
  cash_uncounted_pesewas: number
  fb: { orders: number; open_tabs: number; unpaid: number; voided: number; avg_pesewas: number }
  door: { admitted: number; issued: number; capacity: number | null }
  rail: { waiting_items: number; oldest_secs: number }
  tables: Array<{ label: string; zone: string; min_spend_pesewas: number; spend_pesewas: number; open_tab: boolean }>
  movers: Array<{ product_name: string; station: string; qty: number; revenue_pesewas: number }>
}

interface Waiter {
  waiter_id: string
  waiter_name: string
  expected_pesewas: number
  handed_in_pesewas: number
  variance_pesewas: number
  order_count: number
  counted: boolean
}

function mins(secs: number) {
  if (secs < 60) return `${secs}s`
  return `${Math.floor(secs / 60)}m`
}

export default function OwnerDashboard() {
  const [d, setD] = useState<Dashboard | null>(null)
  const [waiters, setWaiters] = useState<Waiter[]>([])
  const [open, setOpen] = useState(false)
  const [clock, setClock] = useState('')
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    const res = await fetch('/api/night', { cache: 'no-store' })
    if (res.status === 401 || res.status === 403) { window.location.href = '/staff/login'; return }
    const j = await res.json() as { dashboard?: Dashboard; waiters?: Waiter[]; open?: boolean; error?: string }
    if (j.error) { setErr(j.error); return }
    setErr('')
    setD(j.dashboard ?? null)
    setWaiters(j.waiters ?? [])
    setOpen(!!j.open)
  }, [])

  useEffect(() => {
    void load()
    const poll = setInterval(() => void load(), 8000)
    const tick = setInterval(() => {
      setClock(new Date().toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' }))
    }, 1000)
    return () => { clearInterval(poll); clearInterval(tick) }
  }, [load])

  const gross = d?.night.gross_pesewas ?? 0
  const admitted = d?.door.admitted ?? 0
  const perHead = admitted > 0 ? Math.round(gross / admitted) : 0
  const capacity = d?.door.capacity ?? 0
  const full = capacity > 0 ? Math.min(100, Math.round((admitted / capacity) * 100)) : 0

  // The three things that go wrong on a night, ranked by how much they cost.
  const alerts: Array<{ tone: 'bad' | 'warn'; text: string }> = []
  if (d) {
    const shortest = waiters.filter(w => w.counted && w.variance_pesewas > 5000)
    if (shortest.length > 0) {
      alerts.push({
        tone: 'bad',
        text: `${shortest.map(w => w.waiter_name.split(' ')[0]).join(', ')} counted short — ${formatAmount(shortest.reduce((s, w) => s + w.variance_pesewas, 0))} unaccounted.`,
      })
    }
    if (d.cash_uncounted_pesewas > 0) {
      alerts.push({
        tone: 'warn',
        text: `${formatAmount(d.cash_uncounted_pesewas)} of cash is still out with servers who have not been counted down.`,
      })
    }
    if (d.rail.oldest_secs > 420 && d.rail.waiting_items > 0) {
      alerts.push({
        tone: 'warn',
        text: `Oldest ticket on the rail is ${mins(d.rail.oldest_secs)} old. ${d.rail.waiting_items} lines waiting.`,
      })
    }
    if (d.fb.open_tabs > 0 && !open) {
      alerts.push({ tone: 'bad', text: `${d.fb.open_tabs} table(s) left on an unbilled tab.` })
    }
  }

  return (
    <div className="min-h-screen bg-[#08070D] text-[#F3EDE4]" data-tenant="memories-nc">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-[#2A242C] px-6 py-5">
        <div>
          <Wordmark href="/" size="sm" />
          <p className="mt-2 text-[11px] uppercase tracking-[0.28em] text-[#8A8580]">
            {open ? 'The night, live' : 'Last night'}
            {d && ` · doors ${new Date(d.opened_at).toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' })}`}
          </p>
        </div>
        <div className="flex items-center gap-5">
          <span className="font-mono text-[13px] text-[#C4B8A8]">{clock}</span>
          <nav className="flex flex-wrap gap-4 text-[11px] uppercase tracking-[0.18em] text-[#8A8580]">
            <Link className="hover:text-[#F3EDE4]" href="/dashboard/shift-close">Count down</Link>
            <Link className="hover:text-[#F3EDE4]" href="/floor">Floor</Link>
            <Link className="hover:text-[#F3EDE4]" href="/organiser">Organiser</Link>
            <Link className="hover:text-[#F3EDE4]" href="/reissue">Reissue</Link>
          </nav>
        </div>
      </header>

      {err && <p className="border-b border-ev-crimson/40 bg-ev-crimson/10 px-6 py-3 text-[13px]">{err}</p>}
      {!d && !err && <p className="px-6 py-16 text-center text-[14px] text-[#8A8580]">Reading the night…</p>}

      {d && (
        <main className="px-6 py-8">
          {/* One number, the size it deserves. An owner walking past a screen
              should be able to read the night from the doorway — the old grid
              of eight identical tiles made the total no more prominent than
              the Paystack fee line. */}
          <section className="border-b border-[#2A242C] pb-8">
            <p className="text-[11px] uppercase tracking-[0.28em] text-[#8A8580]">Taken tonight</p>
            <p className="mt-2 font-mono text-[56px] leading-none sm:text-[76px]">{formatAmount(gross)}</p>
            <div className="mt-5 flex flex-wrap gap-x-10 gap-y-3 text-[13px]">
              <span><span className="text-[#8A8580]">Door </span><span className="font-mono">{formatAmount(d.night.gate_pesewas)}</span></span>
              <span><span className="text-[#8A8580]">Bar and kitchen </span><span className="font-mono">{formatAmount(d.night.fb_pesewas)}</span></span>
              <span><span className="text-[#8A8580]">Per head </span><span className="font-mono">{formatAmount(perHead)}</span></span>
              <span><span className="text-[#8A8580]">Fees </span><span className="font-mono text-[#E0A24A]">−{formatAmount(d.ledger.fees)}</span></span>
            </div>
          </section>

          {alerts.length > 0 && (
            <section className="mt-8 space-y-2">
              {alerts.map((a, i) => (
                <p
                  key={i}
                  className="border-l-2 py-2 pl-4 text-[14px]"
                  style={{ borderColor: a.tone === 'bad' ? '#B8122A' : '#E0A24A' }}
                >
                  {a.text}
                </p>
              ))}
            </section>
          )}

          <div className="mt-10 grid gap-8 lg:grid-cols-3">
            {/* How the money arrived — the split that decides how much of the
                night is sitting in an apron rather than in a bank. */}
            <section>
              <h2 className="text-[11px] uppercase tracking-[0.24em] text-[#8A8580]">How it came in</h2>
              <div className="mt-4 space-y-3">
                {[
                  { label: 'MoMo', value: d.ledger.momo_gross, tone: '#F3EDE4' },
                  { label: 'Cash', value: d.ledger.cash_gross, tone: '#F3EDE4' },
                  { label: 'Cash not yet counted', value: d.cash_uncounted_pesewas, tone: '#E0A24A' },
                  { label: 'Comps', value: d.ledger.comps, tone: '#8A8580' },
                  { label: 'Refunds', value: d.ledger.refunds, tone: '#8A8580' },
                ].map(r => {
                  const total = d.ledger.momo_gross + d.ledger.cash_gross
                  const pct = total > 0 ? Math.round((r.value / total) * 100) : 0
                  return (
                    <div key={r.label}>
                      <div className="flex items-baseline justify-between text-[13px]">
                        <span className="text-[#8A8580]">{r.label}</span>
                        <span className="font-mono" style={{ color: r.tone }}>{formatAmount(r.value)}</span>
                      </div>
                      <div className="mt-1 h-[2px] bg-[#2A242C]">
                        <div className="h-full" style={{ width: `${pct}%`, background: r.tone }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>

            {/* The room. Capacity is the number that decides next week's
                allocation, and it was nowhere on the old screen. */}
            <section>
              <h2 className="text-[11px] uppercase tracking-[0.24em] text-[#8A8580]">The room</h2>
              <p className="mt-4 font-mono text-[40px] leading-none">
                {admitted}
                <span className="text-[16px] text-[#8A8580]"> / {d.door.issued} sold</span>
              </p>
              {capacity > 0 && (
                <>
                  <div className="mt-3 h-[6px] bg-[#2A242C]">
                    <div className="h-full bg-ev-crimson" style={{ width: `${full}%` }} />
                  </div>
                  <p className="mt-2 text-[12px] text-[#8A8580]">
                    {full}% of {capacity} capacity · {d.door.issued - admitted} sold and never came
                  </p>
                </>
              )}
              <dl className="mt-6 space-y-2 text-[13px]">
                <div className="flex justify-between"><dt className="text-[#8A8580]">Orders</dt><dd className="font-mono">{d.fb.orders}</dd></div>
                <div className="flex justify-between"><dt className="text-[#8A8580]">Average order</dt><dd className="font-mono">{formatAmount(d.fb.avg_pesewas)}</dd></div>
                <div className="flex justify-between">
                  <dt className="text-[#8A8580]">On the rail</dt>
                  <dd className="font-mono" style={{ color: d.rail.oldest_secs > 420 ? '#B8122A' : '#F3EDE4' }}>
                    {d.rail.waiting_items} · oldest {mins(d.rail.oldest_secs)}
                  </dd>
                </div>
                <div className="flex justify-between"><dt className="text-[#8A8580]">Open tabs</dt><dd className="font-mono">{d.fb.open_tabs}</dd></div>
              </dl>
            </section>

            {/* What to reorder in the morning. */}
            <section>
              <h2 className="text-[11px] uppercase tracking-[0.24em] text-[#8A8580]">Moving tonight</h2>
              <div className="mt-4 space-y-2">
                {d.movers.map(m => {
                  const top = d.movers[0]?.revenue_pesewas ?? 1
                  return (
                    <div key={m.product_name}>
                      <div className="flex items-baseline justify-between text-[13px]">
                        <span>{m.product_name} <span className="text-[#6B6570]">×{m.qty}</span></span>
                        <span className="font-mono text-[#C4B8A8]">{formatAmount(m.revenue_pesewas)}</span>
                      </div>
                      <div className="mt-1 h-[2px] bg-[#2A242C]">
                        <div
                          className="h-full"
                          style={{
                            width: `${Math.round((m.revenue_pesewas / top) * 100)}%`,
                            background: m.station === 'bar' ? '#B8122A' : '#C4B8A8',
                          }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          </div>

          {/* Tables against their minimum. */}
          <section className="mt-12">
            <h2 className="text-[11px] uppercase tracking-[0.24em] text-[#8A8580]">Tables against minimum</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {d.tables.map(t => {
                const pct = t.min_spend_pesewas > 0
                  ? Math.min(100, Math.round((t.spend_pesewas / t.min_spend_pesewas) * 100))
                  : 100
                const met = pct >= 100
                return (
                  <div key={t.label} className="border border-[#2A242C] bg-[#100E14] p-3">
                    <p className="font-display text-[20px] leading-none">{t.label}</p>
                    <p className="mt-2 font-mono text-[15px]">{formatAmount(t.spend_pesewas)}</p>
                    <div className="mt-2 h-[3px] bg-[#2A242C]">
                      <div className="h-full" style={{ width: `${pct}%`, background: met ? '#1A5C2E' : '#E0A24A' }} />
                    </div>
                    <p className="mt-2 text-[10px] uppercase tracking-[0.14em]" style={{ color: met ? '#7DCF8A' : '#E0A24A' }}>
                      {met ? 'Min met' : `${formatAmount(t.min_spend_pesewas - t.spend_pesewas)} short`}
                      {t.open_tab && ' · tab open'}
                    </p>
                  </div>
                )
              })}
            </div>
          </section>

          {/* The reconciliation. Sorted worst first by the RPC, so the row that
              needs a conversation is the row at the top. */}
          <section className="mt-12">
            <div className="flex items-baseline justify-between">
              <h2 className="text-[11px] uppercase tracking-[0.24em] text-[#8A8580]">Cash reconciliation</h2>
              <Link href="/dashboard/shift-close" className="text-[11px] uppercase tracking-[0.18em] text-ev-crimson">
                Count servers down →
              </Link>
            </div>
            <div className="mt-4 overflow-x-auto border border-[#2A242C]">
              <table className="w-full min-w-[560px]">
                <thead>
                  <tr className="border-b border-[#2A242C] text-left text-[10px] uppercase tracking-[0.18em] text-[#6B6570]">
                    {['Server', 'Orders', 'Expected', 'Counted in', 'Variance'].map(h => (
                      <th key={h} className="px-4 py-3 font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {waiters.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-[13px] text-[#8A8580]">
                      No cash taken this shift.
                    </td></tr>
                  )}
                  {waiters.map(w => {
                    const short = w.counted && w.variance_pesewas > 0
                    const serious = w.counted && w.variance_pesewas > 5000
                    return (
                      <tr key={w.waiter_id} className="border-b border-[#2A242C] last:border-0">
                        <td className="px-4 py-3 text-[14px]">{w.waiter_name}</td>
                        <td className="px-4 py-3 font-mono text-[13px] text-[#8A8580]">{w.order_count}</td>
                        <td className="px-4 py-3 font-mono text-[14px]">{formatAmount(w.expected_pesewas)}</td>
                        <td className="px-4 py-3 font-mono text-[14px]">
                          {w.counted ? formatAmount(w.handed_in_pesewas)
                            : <span className="text-[11px] uppercase tracking-[0.16em] text-[#E0A24A]">Not counted</span>}
                        </td>
                        <td
                          className="px-4 py-3 font-mono text-[14px]"
                          style={{ color: !w.counted ? '#6B6570' : serious ? '#B8122A' : short ? '#E0A24A' : '#7DCF8A' }}
                        >
                          {w.counted
                            ? (w.variance_pesewas === 0 ? 'Straight'
                              : `${w.variance_pesewas > 0 ? '−' : '+'}${formatAmount(Math.abs(w.variance_pesewas))}`)
                            : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </main>
      )}
    </div>
  )
}
