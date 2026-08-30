'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { formatAmount } from '@evolveit/shared/money'
import { Wordmark } from '@/components/Wordmark'

interface Waiter {
  waiter_id: string
  waiter_name: string
  expected_pesewas: number
  handed_in_pesewas: number
  variance_pesewas: number
  order_count: number
  counted: boolean
}

export default function ShiftClosePage() {
  const [shiftId, setShiftId] = useState<string | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [waiters, setWaiters] = useState<Waiter[]>([])
  const [openTabs, setOpenTabs] = useState(0)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [note, setNote] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [closed, setClosed] = useState(false)

  /**
   * The old page fired POST /api/shifts/open on mount — so simply looking at
   * the close screen opened a shift — and then never populated `waiters`, so
   * it rendered no inputs at all. The night's most important ritual was a
   * textarea and a button that dumped raw JSON.
   */
  const load = useCallback(async () => {
    const res = await fetch('/api/night', { cache: 'no-store' })
    if (res.status === 401 || res.status === 403) { window.location.href = '/staff/login'; return }
    const d = await res.json() as {
      shift_id?: string; open?: boolean; waiters?: Waiter[]
      dashboard?: { fb?: { open_tabs?: number } }
    }
    setShiftId(d.shift_id ?? null)
    setIsOpen(!!d.open)
    setWaiters(d.waiters ?? [])
    setOpenTabs(d.dashboard?.fb?.open_tabs ?? 0)
  }, [])

  useEffect(() => { void load() }, [load])

  async function count(w: Waiter) {
    const raw = draft[w.waiter_id]
    const cedis = Number(raw)
    if (!raw || !Number.isFinite(cedis) || cedis < 0) {
      setErr(`Enter what ${w.waiter_name.split(' ')[0]} actually handed over.`)
      return
    }
    setBusy(true)
    setErr('')
    const res = await fetch('/api/shifts/close', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shift_id: shiftId,
        waiter_id: w.waiter_id,
        physical_amount_pesewas: Math.round(cedis * 100),
        note: note[w.waiter_id] ?? null,
      }),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({})) as { error?: string }
      setErr(d.error ?? 'Could not record that count.')
    } else {
      setDraft(p => ({ ...p, [w.waiter_id]: '' }))
    }
    setBusy(false)
    void load()
  }

  async function closeNight() {
    setBusy(true)
    setErr('')
    const res = await fetch('/api/shifts/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shift_id: shiftId, notes }),
    })
    const d = await res.json().catch(() => ({})) as { error?: string }
    if (!res.ok) setErr(d.error ?? 'Could not close the night.')
    else setClosed(true)
    setBusy(false)
    void load()
  }

  const uncounted = waiters.filter(w => !w.counted)
  const totalExpected = waiters.reduce((s, w) => s + w.expected_pesewas, 0)
  const totalCounted = waiters.filter(w => w.counted).reduce((s, w) => s + w.handed_in_pesewas, 0)
  const totalVariance = waiters.filter(w => w.counted).reduce((s, w) => s + w.variance_pesewas, 0)
  const canClose = isOpen && uncounted.length === 0 && openTabs === 0

  return (
    <div className="min-h-screen bg-[#08070D] text-[#F3EDE4]" data-tenant="memories-nc">
      <header className="flex items-end justify-between border-b border-[#2A242C] px-6 py-5">
        <div>
          <Wordmark href="/dashboard" size="sm" />
          <p className="mt-2 text-[11px] uppercase tracking-[0.28em] text-[#8A8580]">Counting down</p>
        </div>
        <Link href="/dashboard" className="text-[11px] uppercase tracking-[0.18em] text-[#8A8580]">
          ← The night
        </Link>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8">
        {!shiftId && <p className="text-[14px] text-[#8A8580]">No shift on record.</p>}

        {closed && (
          <div className="mb-8 border-l-2 border-[#1A5C2E] py-3 pl-4">
            <p className="font-display text-[24px]">The night is closed.</p>
            <p className="mt-1 text-[13px] text-[#8A8580]">
              Variances are posted to the ledger. Nothing further can be booked to this shift.
            </p>
          </div>
        )}

        {shiftId && !closed && (
          <>
            <section className="grid grid-cols-3 gap-4 border-b border-[#2A242C] pb-6">
              {[
                { k: 'Cash expected', v: formatAmount(totalExpected), tone: '#F3EDE4' },
                { k: 'Counted in', v: formatAmount(totalCounted), tone: '#F3EDE4' },
                {
                  k: totalVariance > 0 ? 'Short' : totalVariance < 0 ? 'Over' : 'Variance',
                  v: formatAmount(Math.abs(totalVariance)),
                  tone: totalVariance > 5000 ? '#B8122A' : totalVariance !== 0 ? '#E0A24A' : '#7DCF8A',
                },
              ].map(t => (
                <div key={t.k}>
                  <p className="text-[10px] uppercase tracking-[0.2em] text-[#8A8580]">{t.k}</p>
                  <p className="mt-2 font-mono text-[22px]" style={{ color: t.tone }}>{t.v}</p>
                </div>
              ))}
            </section>

            {err && (
              <p className="mt-6 border-l-2 border-ev-crimson py-2 pl-4 text-[14px]">{err}</p>
            )}

            <div className="mt-8 space-y-4">
              {waiters.length === 0 && (
                <p className="text-[14px] text-[#8A8580]">No server took cash tonight. Nothing to count.</p>
              )}

              {waiters.map(w => (
                <section
                  key={w.waiter_id}
                  className="border p-4"
                  style={{ borderColor: w.counted ? '#1A5C2E' : '#2A242C', background: '#100E14' }}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-display text-[22px]">{w.waiter_name}</p>
                    <p className="text-[12px] text-[#8A8580]">
                      {w.order_count} cash order{w.order_count === 1 ? '' : 's'} ·
                      owes <span className="font-mono text-[#F3EDE4]">{formatAmount(w.expected_pesewas)}</span>
                    </p>
                  </div>

                  {w.counted ? (
                    <p className="mt-3 text-[14px]">
                      Counted in at <span className="font-mono">{formatAmount(w.handed_in_pesewas)}</span>
                      {w.variance_pesewas === 0
                        ? <span className="text-[#7DCF8A]"> · straight</span>
                        : (
                          <span style={{ color: w.variance_pesewas > 5000 ? '#B8122A' : '#E0A24A' }}>
                            {' '}· {w.variance_pesewas > 0 ? 'short' : 'over'} {formatAmount(Math.abs(w.variance_pesewas))}
                          </span>
                        )}
                    </p>
                  ) : (
                    <div className="mt-4 space-y-3">
                      {/* Count the cash before you look at the expected figure:
                          a number on a screen anchors what you think you are
                          holding. This is why the input is not prefilled. */}
                      <div className="flex items-stretch border border-[#2A242C]">
                        <span className="flex items-center border-r border-[#2A242C] bg-[#08070D] px-4 text-[13px] text-[#8A8580]">
                          GHS
                        </span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          inputMode="decimal"
                          value={draft[w.waiter_id] ?? ''}
                          onChange={e => setDraft(p => ({ ...p, [w.waiter_id]: e.target.value }))}
                          placeholder="Count the notes first"
                          className="h-14 flex-1 bg-[#08070D] px-4 font-mono text-[20px] text-[#F3EDE4] placeholder:font-body placeholder:text-[13px] placeholder:text-[#6B6570] focus:outline-none"
                        />
                      </div>
                      <input
                        type="text"
                        value={note[w.waiter_id] ?? ''}
                        onChange={e => setNote(p => ({ ...p, [w.waiter_id]: e.target.value }))}
                        placeholder="Note — only if it does not match"
                        className="h-11 w-full border border-[#2A242C] bg-[#08070D] px-3 text-[13px] text-[#F3EDE4] placeholder:text-[#6B6570] focus:outline-none"
                      />
                      <button
                        onClick={() => void count(w)}
                        disabled={busy}
                        className="h-12 w-full bg-[#1A5C2E] text-[12px] font-semibold uppercase tracking-[0.2em] text-white disabled:opacity-40"
                      >
                        Count {w.waiter_name.split(' ')[0]} in
                      </button>
                    </div>
                  )}
                </section>
              ))}
            </div>

            <section className="mt-10 border-t border-[#2A242C] pt-6">
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Anything the owner should know about tonight"
                className="h-24 w-full border border-[#2A242C] bg-[#100E14] p-3 text-[14px] text-[#F3EDE4] placeholder:text-[#6B6570] focus:outline-none"
              />

              {!canClose && isOpen && (
                <p className="mt-3 text-[13px] text-[#E0A24A]">
                  {openTabs > 0 && `${openTabs} table${openTabs === 1 ? '' : 's'} still on an open tab. `}
                  {uncounted.length > 0 && `${uncounted.map(w => w.waiter_name.split(' ')[0]).join(', ')} not counted yet.`}
                </p>
              )}
              {!isOpen && (
                <p className="mt-3 text-[13px] text-[#8A8580]">This shift is already closed.</p>
              )}

              <button
                onClick={() => void closeNight()}
                disabled={busy || !canClose}
                className="mt-4 h-14 w-full bg-ev-crimson text-[13px] font-semibold uppercase tracking-[0.22em] text-white disabled:opacity-30"
              >
                {busy ? 'Closing…' : 'Close the night'}
              </button>
            </section>
          </>
        )}
      </main>
    </div>
  )
}
