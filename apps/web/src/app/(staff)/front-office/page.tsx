'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { formatAmount } from '@evolveit/shared/money'
import { Wordmark } from '@/components/Wordmark'

interface TicketTypeOption {
  id: string
  name: string
  price_pesewas: number
  remaining: number
}
interface EventOption {
  id: string
  name: string
  ticket_types: TicketTypeOption[]
}
interface TableOption {
  id: string
  label: string
  zone: string
  seats: number
  min_spend_pesewas: number
}

const field = 'h-11 w-full border border-ev-border bg-ev-bg px-3 text-[14px] text-ev-primary outline-none focus:border-ev-crimson'
const label = 'text-[11px] uppercase tracking-[0.16em] text-ev-muted'

export default function FrontOfficePage() {
  const [events, setEvents] = useState<EventOption[]>([])
  const [tables, setTables] = useState<TableOption[]>([])

  useEffect(() => {
    void fetch('/api/staff/me').then(r => {
      if (r.status === 401) window.location.href = '/staff/login'
    })
    void fetch('/api/events').then(r => r.json()).then((j: { events?: EventOption[] }) => setEvents(j.events ?? []))
    void fetch('/api/tables').then(r => r.json()).then((j: { tables?: TableOption[] }) => setTables(j.tables ?? []))
  }, [])

  return (
    <div className="min-h-screen bg-ev-bg text-ev-primary" data-tenant="memories-nc">
      <header className="flex items-center justify-between border-b border-ev-border px-6 py-5">
        <Wordmark href="/" size="sm" />
        <p className="text-[11px] uppercase tracking-[0.28em] text-ev-muted">Front Office</p>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-8 space-y-10">
        <SellTicket events={events} />
        <ValidateTicket />
        <BookTable events={events} tables={tables} />
      </main>
    </div>
  )
}

function SellTicket({ events }: { events: EventOption[] }) {
  const [eventId, setEventId] = useState('')
  const [typeId, setTypeId] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)

  const event = events.find(e => e.id === eventId)
  const types = event?.ticket_types ?? []
  const type = types.find(t => t.id === typeId)

  async function sell() {
    if (!typeId || !name || !phone) { setMsg({ tone: 'err', text: 'Pick a ticket type, and enter the guest’s name and number.' }); return }
    setBusy(true)
    setMsg(null)
    const res = await fetch('/api/front-office/sell-ticket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket_type_id: typeId, quantity, buyer_name: name, buyer_phone: phone }),
    })
    const j = await res.json() as { ok?: boolean; error?: string; ticket_ids?: string[] }
    setBusy(false)
    if (!j.ok) { setMsg({ tone: 'err', text: j.error ?? 'Could not complete the sale.' }); return }
    setMsg({ tone: 'ok', text: `Sold ${j.ticket_ids?.length ?? quantity} ticket(s). Sent to ${phone}.` })
    setName('')
    setPhone('')
    setQuantity(1)
  }

  return (
    <section>
      <h2 className="text-[11px] uppercase tracking-[0.2em] text-ev-crimson">Sell a ticket · cash</h2>
      <p className="mt-1 text-[13px] text-ev-muted">For a guest paying cash at the door — right now, not online.</p>
      {msg && (
        <p className={`mt-3 border-l-2 pl-4 text-[13px] ${msg.tone === 'ok' ? 'border-[#7DCF8A] text-[#7DCF8A]' : 'border-ev-crimson text-ev-crimson'}`}>
          {msg.text}
        </p>
      )}
      <div className="mt-4 grid gap-3">
        <select className={field} value={eventId} onChange={e => { setEventId(e.target.value); setTypeId('') }}>
          <option value="">Choose an event</option>
          {events.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <select className={field} value={typeId} onChange={e => setTypeId(e.target.value)} disabled={!eventId}>
          <option value="">Choose a ticket type</option>
          {types.map(t => (
            <option key={t.id} value={t.id} disabled={t.remaining < 1}>
              {t.name} · {formatAmount(t.price_pesewas)} {t.remaining < 1 ? '· sold out' : `· ${t.remaining} left`}
            </option>
          ))}
        </select>
        <div className="grid grid-cols-2 gap-3">
          <input className={field} placeholder="Guest name" value={name} onChange={e => setName(e.target.value)} />
          <input className={field} placeholder="Guest number" value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" />
        </div>
        <label className="grid gap-1"><span className={label}>Quantity</span>
          <input type="number" min={1} max={6} className={field} value={quantity} onChange={e => setQuantity(Number(e.target.value))} /></label>
        {type && (
          <p className="text-[13px] text-ev-secondary">Total: <span className="font-mono">{formatAmount(type.price_pesewas * quantity)}</span></p>
        )}
        <button
          disabled={busy}
          onClick={() => void sell()}
          className="h-12 bg-ev-crimson text-[13px] font-semibold uppercase tracking-[0.2em] text-white disabled:opacity-60"
        >
          {busy ? 'Selling…' : 'Take cash & issue'}
        </button>
      </div>
    </section>
  )
}

function ValidateTicket() {
  return (
    <section className="border-t border-ev-border pt-8">
      <h2 className="text-[11px] uppercase tracking-[0.2em] text-ev-crimson">Validate a ticket</h2>
      <p className="mt-1 text-[13px] text-ev-muted">Scan the guest's pass the same way the door does.</p>
      <Link
        href="/scanner"
        className="mt-4 flex h-12 items-center justify-center border border-ev-border text-[13px] font-semibold uppercase tracking-[0.2em] text-ev-primary hover:border-ev-crimson"
      >
        Open the scanner
      </Link>
    </section>
  )
}

function BookTable({ events, tables }: { events: EventOption[]; tables: TableOption[] }) {
  const [eventId, setEventId] = useState('')
  const [tableId, setTableId] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [when, setWhen] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)

  async function book() {
    if (!tableId || !name || !phone || !when) { setMsg({ tone: 'err', text: 'Fill in the table, guest and time.' }); return }
    setBusy(true)
    setMsg(null)
    const res = await fetch('/api/reservations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        venue_table_id: tableId,
        event_id: eventId || undefined,
        guest_name: name,
        guest_phone: phone,
        reserved_for: new Date(when).toISOString(),
      }),
    })
    const j = await res.json() as { id?: string; error?: string }
    setBusy(false)
    if (j.error) { setMsg({ tone: 'err', text: j.error }); return }
    setMsg({ tone: 'ok', text: 'Table held. The guest is not marked arrived until they show up.' })
    setName('')
    setPhone('')
  }

  return (
    <section className="border-t border-ev-border pt-8">
      <h2 className="text-[11px] uppercase tracking-[0.2em] text-ev-crimson">Book a table</h2>
      <p className="mt-1 text-[13px] text-ev-muted">For a guest who hasn't come through the door yet.</p>
      {msg && (
        <p className={`mt-3 border-l-2 pl-4 text-[13px] ${msg.tone === 'ok' ? 'border-[#7DCF8A] text-[#7DCF8A]' : 'border-ev-crimson text-ev-crimson'}`}>
          {msg.text}
        </p>
      )}
      <div className="mt-4 grid gap-3">
        <select className={field} value={eventId} onChange={e => setEventId(e.target.value)}>
          <option value="">No specific event</option>
          {events.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <select className={field} value={tableId} onChange={e => setTableId(e.target.value)}>
          <option value="">Choose a table</option>
          {tables.map(t => (
            <option key={t.id} value={t.id}>{t.label} · {t.zone} · seats {t.seats} · min {formatAmount(t.min_spend_pesewas)}</option>
          ))}
        </select>
        <div className="grid grid-cols-2 gap-3">
          <input className={field} placeholder="Guest name" value={name} onChange={e => setName(e.target.value)} />
          <input className={field} placeholder="Guest number" value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" />
        </div>
        <label className="grid gap-1"><span className={label}>Arriving around</span>
          <input type="datetime-local" className={field} value={when} onChange={e => setWhen(e.target.value)} /></label>
        <button
          disabled={busy}
          onClick={() => void book()}
          className="h-12 bg-ev-crimson text-[13px] font-semibold uppercase tracking-[0.2em] text-white disabled:opacity-60"
        >
          {busy ? 'Booking…' : 'Hold the table'}
        </button>
      </div>
    </section>
  )
}
