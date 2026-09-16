'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Wordmark } from '@/components/Wordmark'

function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function NewEventPage() {
  const router = useRouter()
  const now = new Date()
  const [form, setForm] = useState({
    name: '',
    description: '',
    host_name: 'Memories Night Club',
    starts_at: toLocalInput(new Date(now.getTime() + 24 * 3600_000)),
    ends_at: toLocalInput(new Date(now.getTime() + 30 * 3600_000)),
    check_in_from: toLocalInput(new Date(now.getTime() + 23 * 3600_000)),
    check_in_until: toLocalInput(new Date(now.getTime() + 31 * 3600_000)),
    venue_capacity: 400,
    status: 'draft',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function submit() {
    if (!form.name || !form.host_name) { setErr('Name and host are required'); return }
    setBusy(true)
    setErr('')
    const res = await fetch('/api/admin/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        starts_at: new Date(form.starts_at).toISOString(),
        ends_at: new Date(form.ends_at).toISOString(),
        check_in_from: new Date(form.check_in_from).toISOString(),
        check_in_until: new Date(form.check_in_until).toISOString(),
      }),
    })
    const j = await res.json() as { id?: string; error?: string }
    setBusy(false)
    if (j.error) { setErr(j.error); return }
    router.push(`/admin/events/${j.id}`)
  }

  const field = 'h-11 w-full border border-ev-border bg-ev-bg px-3 text-[14px] text-ev-primary outline-none focus:border-ev-crimson'
  const label = 'text-[11px] uppercase tracking-[0.16em] text-ev-muted'

  return (
    <div className="min-h-screen bg-ev-bg text-ev-primary">
      <header className="flex items-center justify-between border-b border-ev-border px-6 py-5">
        <Wordmark href="/" size="sm" />
        <Link href="/admin" className="text-[11px] uppercase tracking-[0.18em] text-ev-muted hover:text-ev-primary">← Events</Link>
      </header>

      <main className="mx-auto max-w-xl px-6 py-8">
        <h1 className="font-display text-h1">New event</h1>
        {err && <p className="mt-4 border-l-2 border-ev-crimson pl-4 text-[13px] text-ev-crimson">{err}</p>}

        <div className="mt-6 grid gap-4">
          <label className="grid gap-1"><span className={label}>Name</span>
            <input className={field} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
          <label className="grid gap-1"><span className={label}>Description</span>
            <textarea className="min-h-[80px] border border-ev-border bg-ev-bg p-3 text-[14px] outline-none focus:border-ev-crimson"
              value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></label>
          <label className="grid gap-1"><span className={label}>Host name</span>
            <input className={field} value={form.host_name} onChange={e => setForm({ ...form, host_name: e.target.value })} /></label>

          <div className="grid grid-cols-2 gap-4">
            <label className="grid gap-1"><span className={label}>Starts</span>
              <input type="datetime-local" className={field} value={form.starts_at} onChange={e => setForm({ ...form, starts_at: e.target.value })} /></label>
            <label className="grid gap-1"><span className={label}>Ends</span>
              <input type="datetime-local" className={field} value={form.ends_at} onChange={e => setForm({ ...form, ends_at: e.target.value })} /></label>
            <label className="grid gap-1"><span className={label}>Check-in opens</span>
              <input type="datetime-local" className={field} value={form.check_in_from} onChange={e => setForm({ ...form, check_in_from: e.target.value })} /></label>
            <label className="grid gap-1"><span className={label}>Check-in closes</span>
              <input type="datetime-local" className={field} value={form.check_in_until} onChange={e => setForm({ ...form, check_in_until: e.target.value })} /></label>
          </div>

          <label className="grid gap-1"><span className={label}>Venue capacity</span>
            <input type="number" className={field} value={form.venue_capacity}
              onChange={e => setForm({ ...form, venue_capacity: Number(e.target.value) })} /></label>

          <label className="grid gap-1"><span className={label}>Status</span>
            <select className={field} value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
            </select>
          </label>

          <button
            disabled={busy}
            onClick={() => void submit()}
            className="mt-2 h-12 bg-ev-crimson text-[13px] font-semibold uppercase tracking-[0.2em] text-white disabled:opacity-60"
          >
            {busy ? 'Creating…' : 'Create event'}
          </button>
          <p className="text-[12px] text-ev-muted">
            You'll add ticket types, a flyer and raffle prizes on the next screen.
          </p>
        </div>
      </main>
    </div>
  )
}
