'use client'
import { useEffect, useState } from 'react'
import { formatAmount } from '@evolveit/shared/money'

interface Sub {
  id: string
  event_name: string
  host_name: string
  preferred_date: string
  status: string
  estimated_attendance: number
}

export default function OrganiserPage() {
  const [subs, setSubs] = useState<Sub[]>([])
  const [form, setForm] = useState({ event_name: '', preferred_date: '', description: '', estimated_attendance: 150 })
  const [eventId, setEventId] = useState('')
  const [settlement, setSettlement] = useState<Record<string, number> | null>(null)

  async function load() {
    const r = await fetch('/api/organiser/submissions').then(x => x.json())
    setSubs(r.submissions ?? [])
  }
  useEffect(() => { void load() }, [])

  return (
    <main className="min-h-screen bg-ev-page p-6">
      <h1 className="font-display text-h1 mb-2">Organiser inbox</h1>
      <p className="text-body-md text-ev-muted mb-6">Gate split 30% organiser / 70% club. Table F&amp;B 10% organiser.</p>

      <section className="bg-white border rounded-xl p-4 max-w-lg mb-8 grid gap-2">
        <h2 className="font-semibold">Submit a night</h2>
        <input className="h-12 border rounded px-3" placeholder="Event name" value={form.event_name} onChange={e => setForm({ ...form, event_name: e.target.value })} />
        <input className="h-12 border rounded px-3" type="date" value={form.preferred_date} onChange={e => setForm({ ...form, preferred_date: e.target.value })} />
        <textarea className="h-24 border rounded p-3" placeholder="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
        <button className="h-12 bg-ev-crimson text-white rounded" onClick={() => void fetch('/api/organiser/submissions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) }).then(load)}>
          Send to club
        </button>
      </section>

      <div className="space-y-2 mb-10">
        {subs.map(s => (
          <div key={s.id} className="bg-white border rounded-xl p-4 flex justify-between">
            <div>
              <p className="font-semibold">{s.event_name}</p>
              <p className="text-micro">{s.preferred_date} · {s.status} · {s.estimated_attendance} pax</p>
            </div>
            <div className="flex gap-2">
              <button className="h-10 px-3 border rounded" onClick={() => void fetch('/api/organiser/submissions', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: s.id, status: 'approved' }) }).then(load)}>Approve</button>
              <button className="h-10 px-3 border rounded" onClick={() => void fetch('/api/organiser/submissions', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: s.id, status: 'declined', decline_reason: 'Not this date' }) }).then(load)}>Decline</button>
            </div>
          </div>
        ))}
      </div>

      <section className="bg-white border rounded-xl p-4 max-w-lg">
        <h2 className="font-semibold mb-2">Draft settlement</h2>
        <input className="w-full h-12 border rounded px-3 mb-2" placeholder="Event UUID" value={eventId} onChange={e => setEventId(e.target.value)} />
        <button className="h-12 px-4 bg-ev-navy text-white rounded" onClick={async () => {
          const r = await fetch('/api/organiser/settlement', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event_id: eventId }) })
          const d = await r.json()
          setSettlement(d.settlement)
        }}>Compute 30% draft</button>
        {settlement && (
          <ul className="mt-3 text-body-md">
            <li>Gate gross {formatAmount(settlement.gate_gross ?? 0)}</li>
            <li>Organiser total {formatAmount(settlement.organiser_total ?? 0)}</li>
            <li>Club total {formatAmount(settlement.club_total ?? 0)}</li>
          </ul>
        )}
      </section>
    </main>
  )
}
