'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { formatAmount } from '@evolveit/shared/money'
import { GuestChrome } from '@/components/GuestChrome'

interface EventRow {
  id: string
  name: string
  description: string | null
  host_name: string
  starts_at: string
  ticket_types: Array<{ price_pesewas: number; remaining: number; total: number }>
}

export default function EventsListPage() {
  const [events, setEvents] = useState<EventRow[]>([])

  useEffect(() => {
    void fetch('/api/events').then(r => r.json()).then(d => setEvents(d.events ?? []))
  }, [])

  return (
    <GuestChrome kicker="Cape Coast's night">
      <main className="px-5 pb-16">
        <h1 className="font-display text-[42px] leading-[1.05] text-[#F3EDE4]">
          What's on
        </h1>
        <p className="mt-3 max-w-md text-[14px] leading-relaxed text-[#8A8580]">
          Advance is cheaper than the gate. When a night is gone, it is gone.
        </p>

        <div className="mt-8 space-y-6">
          {events.map(ev => {
            const from = ev.ticket_types?.reduce((m, t) => Math.min(m, t.price_pesewas), Infinity)
            const left = ev.ticket_types?.reduce((s, t) => s + (t.remaining ?? 0), 0) ?? 0
            return (
              <Link key={ev.id} href={`/events/${ev.id}`} className="block">
                <article className="relative overflow-hidden">
                  <div className="relative h-52">
                    <img src="/room.jpg" alt="" className="h-full w-full object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#08070D] via-[#08070D]/40 to-transparent" />
                    <p className="absolute left-4 top-4 text-[10px] uppercase tracking-[0.24em] text-[#F3EDE4]/80">
                      {new Date(ev.starts_at).toLocaleString('en-GH', {
                        weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
                      })}
                    </p>
                  </div>
                  <div className="border border-t-0 border-[#2A242C] bg-[#100E14] px-4 py-4">
                    <h2 className="font-display text-[28px] leading-tight">{ev.name}</h2>
                    <p className="mt-2 line-clamp-2 text-[13px] text-[#8A8580]">{ev.description}</p>
                    <div className="mt-4 flex items-end justify-between">
                      <p className="text-[13px] uppercase tracking-[0.16em] text-ev-crimson">
                        From {Number.isFinite(from) ? formatAmount(from) : '—'}
                      </p>
                      <p className="text-[11px] uppercase tracking-[0.16em] text-[#8A8580]">
                        {left} left
                      </p>
                    </div>
                  </div>
                </article>
              </Link>
            )
          })}
          {events.length === 0 && (
            <p className="border border-[#2A242C] px-4 py-10 text-center text-[14px] text-[#8A8580]">
              The next night has not been posted.
            </p>
          )}
        </div>
      </main>
    </GuestChrome>
  )
}
