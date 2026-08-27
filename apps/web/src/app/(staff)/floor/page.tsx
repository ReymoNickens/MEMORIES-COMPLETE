'use client'
import { useEffect, useState } from 'react'

interface Reservation {
  id: string
  guest_name: string
  guest_phone: string
  reserved_for: string
  status: string
  venue_tables: { label: string; zone: string; seats: number } | null
}

export default function FloorPage() {
  const [rows, setRows] = useState<Reservation[]>([])
  const [tables, setTables] = useState<Array<{ id: string; label: string }>>([])
  const [form, setForm] = useState({ venue_table_id: '', guest_name: '', guest_phone: '', reserved_for: '' })

  async function load() {
    const r = await fetch('/api/reservations').then(x => x.json())
    setRows(r.reservations ?? [])
    const t = await fetch('/api/tables').then(x => x.json())
    setTables(t.tables ?? [])
  }
  useEffect(() => { void load() }, [])

  async function create() {
    await fetch('/api/reservations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    void load()
  }
  async function patch(id: string, status: string) {
    await fetch('/api/reservations', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) })
    void load()
  }

  return (
    <main className="min-h-screen bg-ev-page p-4">
      <h1 className="font-display text-h1 mb-4">Floor / reservations</h1>
      <div className="bg-white rounded-xl border p-4 mb-6 grid gap-2 max-w-lg">
        <select className="h-12 border rounded px-3" value={form.venue_table_id} onChange={e => setForm({ ...form, venue_table_id: e.target.value })}>
          <option value="">Select table</option>
          {tables.map(tb => <option key={tb.id} value={tb.id}>{tb.label}</option>)}
        </select>
        <input className="h-12 border rounded px-3" placeholder="Guest name" value={form.guest_name} onChange={e => setForm({ ...form, guest_name: e.target.value })} />
        <input className="h-12 border rounded px-3" placeholder="Phone" value={form.guest_phone} onChange={e => setForm({ ...form, guest_phone: e.target.value })} />
        <input className="h-12 border rounded px-3" type="datetime-local" value={form.reserved_for} onChange={e => setForm({ ...form, reserved_for: e.target.value })} />
        <button onClick={() => void create()} className="h-12 bg-ev-crimson text-white rounded">Book table</button>
      </div>
      <div className="space-y-2">
        {rows.map(r => (
          <div key={r.id} className="bg-white border rounded-xl p-4 flex justify-between">
            <div>
              <p className="font-semibold">{r.venue_tables?.label ?? 'Table'} · {r.guest_name}</p>
              <p className="text-micro text-ev-muted">{r.status} · {r.guest_phone}</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => void patch(r.id, 'arrived')} className="h-10 px-3 border rounded">Arrived</button>
              <button onClick={() => void patch(r.id, 'no_show')} className="h-10 px-3 border rounded">No-show</button>
            </div>
          </div>
        ))}
      </div>
    </main>
  )
}
