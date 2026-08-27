'use client'
import { useEffect, useState } from 'react'
import { formatAmount } from '@evolveit/shared/money'

export default function ShiftClosePage() {
  const [shiftId, setShiftId] = useState<string | null>(null)
  const [waiters, setWaiters] = useState<Array<{ waiter_id: string; waiter_name: string; expected_pesewas: number }>>([])
  const [hands, setHands] = useState<Record<string, number>>({})
  const [notes, setNotes] = useState('')
  const [done, setDone] = useState('')

  useEffect(() => {
    void fetch('/api/shifts/open', { method: 'POST' }).then(r => r.json()).then(async d => {
      setShiftId(d.shift_id)
    })
  }, [])

  async function close() {
    const res = await fetch('/api/shifts/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shift_id: shiftId,
        notes,
        hand_ins: Object.entries(hands).map(([waiter_id, physical_amount_pesewas]) => ({ waiter_id, physical_amount_pesewas })),
      }),
    })
    const data = await res.json()
    setDone(JSON.stringify(data, null, 2))
  }

  return (
    <main className="min-h-screen bg-ev-page p-6">
      <h1 className="font-display text-h1 mb-4">Shift close</h1>
      <p className="text-micro text-ev-muted mb-4">Shift {shiftId ?? '…'}</p>
      {waiters.map(w => (
        <label key={w.waiter_id} className="block mb-3">
          {w.waiter_name} expected {formatAmount(w.expected_pesewas)}
          <input className="w-full h-12 border rounded px-3 mt-1" type="number"
            onChange={e => setHands({ ...hands, [w.waiter_id]: Math.round(Number(e.target.value) * 100) })} />
        </label>
      ))}
      <textarea className="w-full h-24 border rounded p-3 mb-3" placeholder="Notes" value={notes} onChange={e => setNotes(e.target.value)} />
      <button onClick={() => void close()} className="h-12 px-6 bg-ev-navy text-white rounded">Close night</button>
      {done && <pre className="mt-4 text-micro whitespace-pre-wrap">{done}</pre>}
    </main>
  )
}
