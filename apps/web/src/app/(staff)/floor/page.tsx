'use client'

import { useEffect, useState } from 'react'
import { FloorShell } from '@/components/FloorShell'

interface Reservation {
  id: string
  guest_name: string
  guest_phone: string
  reserved_for: string
  status: string
  venue_tables: { label: string; zone: string; seats: number } | null
}

interface TableRow { id: string; label: string; zone?: string }

const STATUS: Record<string, string> = {
  held: 'Held',
  booked: 'Held',
  reserved: 'Held',
  arrived: 'Seated',
  seated: 'Seated',
  no_show: 'No-show',
  cancelled: 'Released',
}

export default function FloorPage() {
  const [rows, setRows] = useState<Reservation[]>([])
  const [tables, setTables] = useState<TableRow[]>([])
  const [form, setForm] = useState({ venue_table_id: '', guest_name: '', guest_phone: '', reserved_for: '' })
  const [clock, setClock] = useState('')

  async function load() {
    const r = await fetch('/api/reservations').then(x => x.json())
    setRows(r.reservations ?? [])
    const t = await fetch('/api/tables').then(x => x.json())
    setTables(t.tables ?? [])
  }

  useEffect(() => { void load() }, [])
  useEffect(() => {
    const t = setInterval(() => {
      setClock(new Date().toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' }))
    }, 1000)
    return () => clearInterval(t)
  }, [])

  async function create() {
    await fetch('/api/reservations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    void load()
  }
  async function patch(id: string, status: string) {
    await fetch('/api/reservations', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) })
    void load()
  }

  return (
    <FloorShell station="The floor" clock={clock}>
      <main className="px-5 py-6">
        <p className="max-w-md text-[14px] text-[#8A8580]">A table is a privilege, not a right.</p>

        <div className="mt-6 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {tables.map(tb => {
            const hold = rows.find(r => r.venue_tables?.label === tb.label && !['no_show', 'cancelled'].includes(r.status))
            const seated = hold && ['arrived', 'seated'].includes(hold.status)
            return (
              <button
                key={tb.id}
                onClick={() => setForm(f => ({ ...f, venue_table_id: tb.id }))}
                className="aspect-square border px-2 py-3 text-left"
                style={{
                  borderColor: form.venue_table_id === tb.id ? '#B8122A' : '#2A242C',
                  background: seated ? '#1A5C2E' : hold ? '#3A2A12' : '#100E14',
                }}
              >
                <p className="font-display text-[22px] leading-none">{tb.label}</p>
                <p className="mt-2 text-[10px] uppercase tracking-[0.16em] text-[#C4B8A8]">
                  {hold ? STATUS[hold.status] ?? hold.status : 'Open'}
                </p>
              </button>
            )
          })}
        </div>

        <section className="mt-8 border border-[#2A242C] bg-[#100E14] p-4">
          <p className="text-[11px] uppercase tracking-[0.22em] text-[#8A8580]">Hold a table</p>
          <input className="mt-3 h-12 w-full border border-[#2A242C] bg-[#08070D] px-3 text-[#F3EDE4] placeholder:text-[#6B6570]" placeholder="Guest name" value={form.guest_name} onChange={e => setForm({ ...form, guest_name: e.target.value })} />
          <input className="mt-2 h-12 w-full border border-[#2A242C] bg-[#08070D] px-3 text-[#F3EDE4] placeholder:text-[#6B6570]" placeholder="Phone" value={form.guest_phone} onChange={e => setForm({ ...form, guest_phone: e.target.value })} />
          <input className="mt-2 h-12 w-full border border-[#2A242C] bg-[#08070D] px-3 text-[#F3EDE4]" type="datetime-local" value={form.reserved_for} onChange={e => setForm({ ...form, reserved_for: e.target.value })} />
          <button onClick={() => void create()} className="mt-3 h-12 w-full bg-ev-crimson text-[13px] font-semibold uppercase tracking-[0.18em]">Hold</button>
        </section>

        <div className="mt-6 space-y-2">
          {rows.map(r => (
            <div key={r.id} className="flex items-center justify-between border border-[#2A242C] bg-[#100E14] px-4 py-3">
              <div>
                <p className="font-display text-[20px]">{r.venue_tables?.label ?? 'Table'} \u00b7 {r.guest_name}</p>
                <p className="text-[11px] uppercase tracking-[0.16em] text-[#8A8580]">{STATUS[r.status] ?? r.status}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => void patch(r.id, 'arrived')} className="h-10 px-3 border border-[#2A242C] text-[11px] uppercase tracking-[0.14em]">Seat</button>
                <button onClick={() => void patch(r.id, 'no_show')} className="h-10 px-3 border border-[#2A242C] text-[11px] uppercase tracking-[0.14em]">No-show</button>
              </div>
            </div>
          ))}
        </div>
      </main>
    </FloorShell>
  )
}
