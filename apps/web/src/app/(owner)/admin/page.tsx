'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Wordmark } from '@/components/Wordmark'

interface AdminEvent {
  id: string
  name: string
  host_name: string
  artwork_url: string | null
  starts_at: string
  ends_at: string
  status: 'draft' | 'published' | 'cancelled'
  venue_capacity: number | null
}

const STATUS_TONE: Record<string, string> = {
  draft: '#E0A24A',
  published: '#7DCF8A',
  cancelled: '#6B6570',
}

export default function AdminEventsPage() {
  const [events, setEvents] = useState<AdminEvent[] | null>(null)
  const [err, setErr] = useState('')

  async function load() {
    const res = await fetch('/api/admin/events', { cache: 'no-store' })
    if (res.status === 401 || res.status === 403) { window.location.href = '/staff/login'; return }
    const j = await res.json() as { events?: AdminEvent[]; error?: string }
    if (j.error) { setErr(j.error); return }
    setErr('')
    setEvents(j.events ?? [])
  }

  useEffect(() => { void load() }, [])

  return (
    <div className="min-h-screen bg-ev-bg text-ev-primary" data-tenant="memories-nc">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-ev-border px-6 py-5">
        <div>
          <Wordmark href="/" size="sm" />
          <p className="mt-2 text-[11px] uppercase tracking-[0.28em] text-ev-muted">Admin · Events</p>
        </div>
        <nav className="flex flex-wrap gap-4 text-[11px] uppercase tracking-[0.18em] text-ev-muted">
          <Link className="hover:text-ev-primary" href="/dashboard">Dashboard</Link>
          <Link className="hover:text-ev-primary" href="/admin/settings">Settings</Link>
          <Link className="hover:text-ev-primary" href="/admin/gallery">Gallery</Link>
        </nav>
      </header>

      <main className="px-6 py-8">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-h1">Events</h1>
          <Link
            href="/admin/events/new"
            className="flex h-11 items-center justify-center bg-ev-crimson px-5 text-[13px] font-semibold uppercase tracking-[0.18em] text-white"
          >
            New event
          </Link>
        </div>

        {err && <p className="mt-4 border-l-2 border-ev-crimson pl-4 text-[13px] text-ev-crimson">{err}</p>}
        {!events && !err && <p className="mt-16 text-center text-[14px] text-ev-muted">Loading…</p>}
        {events && events.length === 0 && (
          <p className="mt-16 text-center text-[14px] text-ev-muted">No events yet. Create the first one.</p>
        )}

        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {events?.map(e => (
            <Link
              key={e.id}
              href={`/admin/events/${e.id}`}
              className="block border border-ev-border bg-ev-elevated p-4 hover:border-ev-crimson"
            >
              {e.artwork_url && (
                <img src={e.artwork_url} alt="" className="mb-3 h-32 w-full rounded-sm object-cover" />
              )}
              <div className="flex items-start justify-between gap-2">
                <p className="font-display text-[18px] leading-tight">{e.name}</p>
                <span
                  className="shrink-0 text-[10px] uppercase tracking-[0.14em]"
                  style={{ color: STATUS_TONE[e.status] }}
                >
                  {e.status}
                </span>
              </div>
              <p className="mt-1 text-[13px] text-ev-muted">{e.host_name}</p>
              <p className="mt-2 text-[12px] text-ev-secondary">
                {new Date(e.starts_at).toLocaleString('en-GH', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}
                {e.venue_capacity ? ` · cap ${e.venue_capacity}` : ''}
              </p>
            </Link>
          ))}
        </div>
      </main>
    </div>
  )
}
