'use client'

import { useCallback, useEffect, useState } from 'react'
import { formatAmount } from '@evolveit/shared/money'
import { Wordmark } from '@/components/Wordmark'

interface Row {
  product_id: string
  product_name: string
  opening_qty: number | null
  closing_qty: number | null
  counted: boolean
  consumed_qty: number | null
  pos_sold_qty: number
  adjustment_qty: number
  expected_qty: number | null
  shortage_qty: number | null
  shortage_value_pesewas: number | null
  shortage_status: string | null
  shortage_note: string | null
}

const field = 'h-9 w-20 border border-ev-border bg-ev-bg px-2 text-[13px] text-ev-primary outline-none focus:border-ev-crimson'

export default function StockPage() {
  const [shiftId, setShiftId] = useState<string | null>(null)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [roles, setRoles] = useState<string[]>([])
  const [err, setErr] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const me = await fetch('/api/staff/me').then(r => r.json()) as { session?: { roles?: string[] } }
    setRoles(me.session?.roles ?? [])

    const res = await fetch('/api/stock/reconciliation', { cache: 'no-store' })
    if (res.status === 401 || res.status === 403) { window.location.href = '/staff/login'; return }
    const j = await res.json() as { shift_id?: string | null; rows?: Row[]; error?: string }
    if (j.error) { setErr(j.error); return }
    setErr('')
    setShiftId(j.shift_id ?? null)
    setRows(j.rows ?? [])
  }, [])

  useEffect(() => { void load() }, [load])

  const isManager = roles.includes('manager') || roles.includes('owner')

  async function saveCount(productId: string, kind: 'opening' | 'closing', qty: number) {
    if (!shiftId || Number.isNaN(qty) || qty < 0) return
    setSavingId(productId + kind)
    const res = await fetch('/api/stock/reconciliation/count', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shift_id: shiftId, product_id: productId, kind, qty }),
    })
    setSavingId(null)
    const j = await res.json() as { error?: string }
    if (j.error) { setErr(j.error); return }
    await load()
  }

  async function finalize() {
    if (!shiftId) return
    const res = await fetch('/api/stock/reconciliation/finalize', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shift_id: shiftId }),
    })
    const j = await res.json() as { flagged?: number; error?: string }
    if (j.error) { setErr(j.error); return }
    await load()
  }

  if (!shiftId && rows !== null) {
    return (
      <div className="min-h-screen bg-ev-bg text-ev-primary">
        <Header />
        <p className="px-6 py-16 text-center text-[14px] text-ev-muted">No shift is open right now.</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-ev-bg text-ev-primary">
      <Header />
      <main className="mx-auto max-w-4xl px-6 py-8">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-h1">Bar stock sheet</h1>
          {isManager && shiftId && (
            <button
              onClick={() => void finalize()}
              className="h-11 bg-ev-crimson px-5 text-[12px] font-semibold uppercase tracking-[0.16em] text-white"
            >
              Run reconciliation
            </button>
          )}
        </div>
        <p className="mt-1 text-[13px] text-ev-muted">
          What physically left the shelf versus what the till rang up — the leak cash reconciliation cannot see.
        </p>
        {err && <p className="mt-4 border-l-2 border-ev-crimson pl-4 text-[13px] text-ev-crimson">{err}</p>}

        {rows === null && <p className="mt-16 text-center text-[14px] text-ev-muted">Loading…</p>}

        {rows && rows.length > 0 && (
          <div className="mt-8 overflow-x-auto border border-ev-border">
            <table className="w-full min-w-[860px]">
              <thead>
                <tr className="border-b border-ev-border text-left text-[10px] uppercase tracking-[0.16em] text-ev-muted">
                  {['Product', 'Opening', 'Closing', 'POS sold', 'Adjusted', 'Expected', 'Shortage', 'Status'].map(h => (
                    <th key={h} className="px-3 py-3 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const leaking = r.counted && (r.shortage_qty ?? 0) > 0
                  return (
                    <tr key={r.product_id} className="border-b border-ev-border last:border-0">
                      <td className="px-3 py-2 text-[13px]">{r.product_name}</td>
                      <td className="px-3 py-2">
                        <CountInput
                          value={r.opening_qty}
                          disabled={savingId === r.product_id + 'opening'}
                          onSave={qty => void saveCount(r.product_id, 'opening', qty)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <CountInput
                          value={r.closing_qty}
                          disabled={savingId === r.product_id + 'closing'}
                          onSave={qty => void saveCount(r.product_id, 'closing', qty)}
                        />
                      </td>
                      <td className="px-3 py-2 font-mono text-[13px] text-ev-secondary">{r.pos_sold_qty}</td>
                      <td className="px-3 py-2 font-mono text-[13px] text-ev-secondary">{r.adjustment_qty}</td>
                      <td className="px-3 py-2 font-mono text-[13px] text-ev-secondary">{r.counted ? r.expected_qty : '—'}</td>
                      <td className="px-3 py-2 font-mono text-[13px]" style={{ color: leaking ? '#B8122A' : r.counted ? '#7DCF8A' : '#6B6570' }}>
                        {r.counted ? `${r.shortage_qty} (${formatAmount(r.shortage_value_pesewas ?? 0)})` : 'Not counted'}
                      </td>
                      <td className="px-3 py-2 text-[11px] uppercase tracking-[0.1em]">
                        {r.shortage_status
                          ? <ShortageBadge status={r.shortage_status} />
                          : <span className="text-ev-muted">—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {isManager && <ShortagesInbox />}
      </main>
    </div>
  )
}

interface Shortage {
  id: string
  qty: number
  amount_pesewas: number
  status: string
  note: string | null
  products: { name: string } | null
  shifts: { opened_at: string; closed_at: string | null } | null
}

function ShortagesInbox() {
  const [shortages, setShortages] = useState<Shortage[] | null>(null)

  const load = useCallback(async () => {
    const j = await fetch('/api/stock/shortages').then(r => r.json()) as { shortages?: Shortage[] }
    setShortages(j.shortages ?? [])
  }, [])
  useEffect(() => { void load() }, [load])

  async function resolve(id: string, status: string) {
    await fetch('/api/stock/shortages', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }),
    })
    await load()
  }

  const open = (shortages ?? []).filter(s => s.status === 'open')

  return (
    <section className="mt-10 border-t border-ev-border pt-8">
      <h2 className="text-[11px] uppercase tracking-[0.2em] text-ev-crimson">Shortage inbox</h2>
      <p className="mt-1 text-[13px] text-ev-muted">Every flagged leak, across every shift, waiting on a decision.</p>
      <div className="mt-4 space-y-2">
        {open.length === 0 && <p className="text-[13px] text-ev-muted">Nothing open.</p>}
        {open.map(s => (
          <div key={s.id} className="border border-ev-border bg-ev-elevated px-4 py-3">
            <div className="flex items-center justify-between">
              <p className="text-[14px]">{s.products?.name ?? 'Unknown product'} — {s.qty} unit(s), {formatAmount(s.amount_pesewas)}</p>
              <p className="text-[11px] text-ev-muted">
                {s.shifts?.opened_at ? new Date(s.shifts.opened_at).toLocaleDateString('en-GH') : ''}
              </p>
            </div>
            <div className="mt-2 flex gap-3 text-[11px] uppercase tracking-[0.14em]">
              <button onClick={() => void resolve(s.id, 'waiter_cash')} className="text-ev-secondary underline">Matches cash variance</button>
              <button onClick={() => void resolve(s.id, 'unaccounted_pour')} className="text-ev-crimson underline">Unaccounted pour</button>
              <button onClick={() => void resolve(s.id, 'explained')} className="text-[#7DCF8A] underline">Explained</button>
              <button onClick={() => void resolve(s.id, 'written_off')} className="text-ev-muted underline">Write off</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function Header() {
  return (
    <header className="flex items-center justify-between border-b border-ev-border px-6 py-5">
      <Wordmark href="/" size="sm" />
      <p className="text-[11px] uppercase tracking-[0.28em] text-ev-muted">Bar stock</p>
    </header>
  )
}

function CountInput({ value, disabled, onSave }: { value: number | null; disabled: boolean; onSave: (qty: number) => void }) {
  const [draft, setDraft] = useState(value != null ? String(value) : '')
  useEffect(() => { setDraft(value != null ? String(value) : '') }, [value])
  return (
    <input
      type="number"
      min={0}
      className={field}
      value={draft}
      disabled={disabled}
      placeholder="—"
      onChange={e => setDraft(e.target.value)}
      onBlur={() => { const n = Number(draft); if (draft !== '' && !Number.isNaN(n) && n !== value) onSave(n) }}
    />
  )
}

const STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  waiter_cash: 'Matches cash variance',
  unaccounted_pour: 'Unaccounted pour',
  explained: 'Explained',
  written_off: 'Written off',
}
const STATUS_COLOR: Record<string, string> = {
  open: '#B8122A',
  waiter_cash: '#E0A24A',
  unaccounted_pour: '#E0A24A',
  explained: '#7DCF8A',
  written_off: '#8A8580',
}

function ShortageBadge({ status }: { status: string }) {
  return <span style={{ color: STATUS_COLOR[status] ?? '#8A8580' }}>{STATUS_LABEL[status] ?? status}</span>
}
