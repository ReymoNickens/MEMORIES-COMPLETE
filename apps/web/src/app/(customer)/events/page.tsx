'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { formatAmount } from '@evolveit/shared/money'

interface EventRow {
  id: string
  name: string
  description: string | null
  host_name: string
  starts_at: string
  ticket_types: Array<{ price_pesewas: number; remaining: number }>
}

export default function EventsListPage() {
  const [events, setEvents] = useState<EventRow[]>([])
  useEffect(() => {
    void fetch('/api/events').then(r => r.json()).then(d => setEvents(d.events ?? []))
  }, [])

  return (
    <main className="min-h-screen bg-ev-bg text-white px-5 py-10" data-tenant="memories-nc">
      <p className="text-label text-ev-secondary tracking-widest mb-2">MEMORIES NIGHT CLUB</p>
      <h1 className="font-display text-display-lg mb-8">What&apos;s on</h1>
      <div className="space-y-4 max-w-lg">
        {events.map(ev => {
          const from = ev.ticket_types?.reduce((m, t) => Math.min(m, t.price_pesewas), Infinity)
          return (
            <Link key={ev.id} href={`/events/${ev.id}`} className="block rounded-xl border border-ev-borderDark p-5 bg-ev-elevated">
              <p className="text-micro text-ev-secondary">{new Date(ev.starts_at).toLocaleString('en-GH')}</p>
              <h2 className="font-display text-h1 mt-1">{ev.name}</h2>
              <p className="text-body-md text-ev-secondary mt-2">{ev.description}</p>
              <p className="text-h3 text-ev-crimson mt-3">
                From {Number.isFinite(from) ? formatAmount(from) : '—'}
              </p>
            </Link>
          )
        })}
        {events.length === 0 && <p className="text-ev-secondary">No published nights yet.</p>}
      </div>
    </main>
  )
}
