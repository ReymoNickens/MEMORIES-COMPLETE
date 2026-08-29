'use client'
import { useEffect, useState } from 'react'
import { formatAmount } from '@evolveit/shared/money'

interface WaiterRow { waiter_id: string; waiter_name: string; expected_pesewas: number }

export default function ShiftClosePage() {
  const [shiftId, setShiftId] = useState<string | null>(null)
  const [waiters, setWaiters] = useState<WaiterRow[]>([])
  const [hands, setHands] = useState<Record<string, number>>({})
  const [notes, setNotes] = useState('')
  const [done, setDone] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    void fetch('/api/shifts/open').then(r => r.json()).then((d: { shift_id?: string; waiters?: WaiterRow[]; error?: string }) => {
      if (d.error) { setErr(d.error); return }
      setShiftId(d.shift_id ?? null)
      setWaiters(d.waiters ?? [])
    })
  }, [])

  async function close() {
    if (!shiftId) return
    setErr('')
    const res = await fetch('/api/shifts/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shift_id: shiftId,
        notes,
        hand_ins: Object.entries(hands).map(([waiter_id, physical_amount_pesewas]) => ({ waiter_id, physical_amount_pesewas })),
      }),
    })
    const data = await res.json() as { ok?: boolean; error?: string; revenue?: unknown; waiters?: WaiterRow[] }
    if (!res.ok) { setErr(data.error ?? 'Close failed'); return }
    setDone(JSON.stringify({ revenue: data.revenue, waiters: data.waiters }, null, 2))
  }

  return (
    <main className="min-h-screen bg-ev-page p-6">
      <h1 className="font-display text-h1 mb-4">Shift close</h1>
      {err && <p className="text-ev-crimson mb-4">{err}</p>}
      {!shiftId && !err && <p className="text-ev-muted text-micro mb-4">Loading shift…</p>}
      {shiftId && <p className="text-micro text-ev-muted mb-4">Shift {shiftId}</p>}
      {waiters.length === 0 && shiftId && (
        <p className="text-micro text-ev-muted mb-4">No cash collections recorded this shift.</p>
      )}
      {waiters.map(w => (
        <label key={w.waiter_id} className="block mb-3">
          {w.waiter_name} — expected {formatAmount(w.expected_pesewas)}
          <input
            className="w-full h-12 border rounded px-3 mt-1"
            type="number"
            placeholder="Physical amount (GHS)"
            onChange={e => setHands({ ...hands, [w.waiter_id]: Math.round(Number(e.target.value) * 100) })}
          />
        </label>
      ))}
      <textarea className="w-full h-24 border rounded p-3 mb-3" placeholder="Notes" value={notes} onChange={e => setNotes(e.target.value)} />
      <button
        disabled={!shiftId || !!done}
        onClick={() => void close()}
        className="h-12 px-6 bg-ev-navy text-white rounded disabled:opacity-40"
      >
        Close night
      </button>
      {done && <pre className="mt-4 text-micro whitespace-pre-wrap">{done}</pre>}
    </main>
  )
}
