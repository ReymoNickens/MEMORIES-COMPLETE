'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { formatAmount } from '@evolveit/shared/money'
import { Wordmark } from '@/components/Wordmark'

interface TicketType {
  id: string
  name: string
  price_pesewas: number
  remaining: number
  total: number
  allow_installments: boolean
}

interface RafflePrize {
  id: string
  name: string
  redemption_type: string
  win_mode: string
  win_probability: number | null
  quantity_available: number
  quantity_remaining: number
  ticket_type_id: string | null
  active: boolean
}

interface EventDetail {
  id: string
  name: string
  description: string | null
  host_name: string
  artwork_url: string | null
  status: string
  starts_at: string
  ends_at: string
  check_in_from: string
  check_in_until: string
  venue_capacity: number | null
  ticket_types: TicketType[]
  raffle_prizes: RafflePrize[]
}

const field = 'h-11 w-full border border-ev-border bg-ev-bg px-3 text-[14px] text-ev-primary outline-none focus:border-ev-crimson'
const label = 'text-[11px] uppercase tracking-[0.16em] text-ev-muted'

export default function EditEventPage() {
  const { id } = useParams<{ id: string }>()
  const [event, setEvent] = useState<EventDetail | null>(null)
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)

  const [ttForm, setTtForm] = useState({ name: '', price_pesewas: 8000, total: 100, allow_installments: false })
  const [prizeForm, setPrizeForm] = useState({
    name: '', redemption_type: 'free_item', win_mode: 'fixed_count',
    win_probability: 0.1, quantity_available: 5, ticket_type_id: '',
    cost_pesewas: 0, ledger_account: 'comps',
  })

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/events/${id}`, { cache: 'no-store' })
    if (res.status === 401 || res.status === 403) { window.location.href = '/staff/login'; return }
    const j = await res.json() as { event?: EventDetail; error?: string }
    if (j.error) { setErr(j.error); return }
    setErr('')
    setEvent(j.event ?? null)
  }, [id])

  useEffect(() => { void load() }, [load])

  async function saveField(patch: Partial<EventDetail>) {
    setSaving(true)
    const res = await fetch(`/api/admin/events/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    })
    const j = await res.json() as { error?: string }
    setSaving(false)
    if (j.error) { setErr(j.error); return }
    await load()
  }

  async function uploadArtwork(file: File) {
    setUploading(true)
    const body = new FormData()
    body.append('file', file)
    const res = await fetch(`/api/admin/events/${id}/artwork`, { method: 'POST', body })
    const j = await res.json() as { error?: string }
    setUploading(false)
    if (j.error) { setErr(j.error); return }
    await load()
  }

  async function addTicketType() {
    if (!ttForm.name) { setErr('Ticket type name is required'); return }
    const res = await fetch(`/api/admin/events/${id}/ticket-types`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...ttForm,
        sale_starts_at: new Date().toISOString(),
        sale_ends_at: event?.starts_at ?? new Date().toISOString(),
      }),
    })
    const j = await res.json() as { error?: string }
    if (j.error) { setErr(j.error); return }
    setErr('')
    setTtForm({ name: '', price_pesewas: 8000, total: 100, allow_installments: false })
    await load()
  }

  async function addPrize() {
    if (!prizeForm.name) { setErr('Prize name is required'); return }
    const res = await fetch(`/api/admin/events/${id}/raffle-prizes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...prizeForm,
        ticket_type_id: prizeForm.ticket_type_id || null,
        ledger_account: prizeForm.cost_pesewas > 0 ? prizeForm.ledger_account : null,
      }),
    })
    const j = await res.json() as { error?: string }
    if (j.error) { setErr(j.error); return }
    setErr('')
    setPrizeForm({ ...prizeForm, name: '' })
    await load()
  }

  if (!event) {
    return (
      <div className="min-h-screen bg-ev-bg text-ev-primary">
        <p className="px-6 py-16 text-center text-[14px] text-ev-muted">{err || 'Loading…'}</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-ev-bg text-ev-primary">
      <header className="flex items-center justify-between border-b border-ev-border px-6 py-5">
        <Wordmark href="/" size="sm" />
        <Link href="/admin" className="text-[11px] uppercase tracking-[0.18em] text-ev-muted hover:text-ev-primary">← Events</Link>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-8">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-h1">{event.name}</h1>
          {saving && <span className="text-[11px] text-ev-muted">Saving…</span>}
        </div>
        {err && <p className="mt-4 border-l-2 border-ev-crimson pl-4 text-[13px] text-ev-crimson">{err}</p>}

        {/* Flyer */}
        <section className="mt-8 border border-ev-border bg-ev-elevated p-4">
          <h2 className="text-[11px] uppercase tracking-[0.2em] text-ev-muted">Flyer</h2>
          {event.artwork_url && <img src={event.artwork_url} alt="" className="mt-3 max-h-64 w-full rounded-sm object-cover" />}
          <input
            type="file" accept="image/jpeg,image/png,image/webp"
            disabled={uploading}
            className="mt-3 text-[13px]"
            onChange={e => { const f = e.target.files?.[0]; if (f) void uploadArtwork(f) }}
          />
          {uploading && <p className="mt-1 text-[12px] text-ev-muted">Uploading…</p>}
        </section>

        {/* Core fields */}
        <section className="mt-6 grid gap-4 border border-ev-border bg-ev-elevated p-4">
          <h2 className="text-[11px] uppercase tracking-[0.2em] text-ev-muted">Details</h2>
          <label className="grid gap-1"><span className={label}>Name</span>
            <input className={field} defaultValue={event.name} onBlur={e => e.target.value !== event.name && void saveField({ name: e.target.value })} /></label>
          <label className="grid gap-1"><span className={label}>Description</span>
            <textarea className="min-h-[80px] border border-ev-border bg-ev-bg p-3 text-[14px] outline-none focus:border-ev-crimson"
              defaultValue={event.description ?? ''} onBlur={e => void saveField({ description: e.target.value })} /></label>
          <label className="grid gap-1"><span className={label}>Status</span>
            <select className={field} value={event.status} onChange={e => void saveField({ status: e.target.value })}>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
        </section>

        {/* Ticket types */}
        <section className="mt-6 border border-ev-border bg-ev-elevated p-4">
          <h2 className="text-[11px] uppercase tracking-[0.2em] text-ev-muted">Ticket types</h2>
          <div className="mt-3 space-y-2">
            {event.ticket_types.map(t => (
              <div key={t.id} className="flex items-center justify-between border-b border-ev-border py-2 text-[13px] last:border-0">
                <span>{t.name}</span>
                <span className="font-mono text-ev-secondary">{formatAmount(t.price_pesewas)} · {t.remaining}/{t.total} left</span>
              </div>
            ))}
            {event.ticket_types.length === 0 && <p className="text-[13px] text-ev-muted">No ticket types yet.</p>}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <input className={field} placeholder="Name (e.g. VIP)" value={ttForm.name} onChange={e => setTtForm({ ...ttForm, name: e.target.value })} />
            <input type="number" className={field} placeholder="Price (pesewas)" value={ttForm.price_pesewas} onChange={e => setTtForm({ ...ttForm, price_pesewas: Number(e.target.value) })} />
            <input type="number" className={field} placeholder="Total" value={ttForm.total} onChange={e => setTtForm({ ...ttForm, total: Number(e.target.value) })} />
            <button onClick={() => void addTicketType()} className="h-11 bg-ev-crimson text-[12px] font-semibold uppercase tracking-[0.16em] text-white">Add</button>
          </div>
        </section>

        {/* Raffle prizes */}
        <section className="mt-6 border border-ev-border bg-ev-elevated p-4">
          <h2 className="text-[11px] uppercase tracking-[0.2em] text-ev-muted">Raffle prizes</h2>
          <div className="mt-3 space-y-2">
            {event.raffle_prizes.map(p => (
              <div key={p.id} className="flex items-center justify-between border-b border-ev-border py-2 text-[13px] last:border-0">
                <span>{p.name} <span className="text-ev-muted">({p.redemption_type})</span></span>
                <span className="font-mono text-ev-secondary">
                  {p.win_mode === 'fixed_count' ? `${p.quantity_remaining}/${p.quantity_available} left` : `${Math.round((p.win_probability ?? 0) * 100)}% odds, ${p.quantity_remaining} left`}
                </span>
              </div>
            ))}
            {event.raffle_prizes.length === 0 && <p className="text-[13px] text-ev-muted">No raffle prizes yet.</p>}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <input className={field} placeholder="Prize name" value={prizeForm.name} onChange={e => setPrizeForm({ ...prizeForm, name: e.target.value })} />
            <select className={field} value={prizeForm.redemption_type} onChange={e => setPrizeForm({ ...prizeForm, redemption_type: e.target.value })}>
              <option value="free_item">Free item</option>
              <option value="upgrade">Upgrade</option>
              <option value="digital_only">Digital only</option>
            </select>
            <select className={field} value={prizeForm.win_mode} onChange={e => setPrizeForm({ ...prizeForm, win_mode: e.target.value })}>
              <option value="fixed_count">Fixed count</option>
              <option value="probability">Probability</option>
            </select>
            <select className={field} value={prizeForm.ticket_type_id} onChange={e => setPrizeForm({ ...prizeForm, ticket_type_id: e.target.value })}>
              <option value="">Any ticket type</option>
              {event.ticket_types.map(t => <option key={t.id} value={t.id}>{t.name} only</option>)}
            </select>
            {prizeForm.win_mode === 'fixed_count' ? (
              <input type="number" className={field} placeholder="Winners" value={prizeForm.quantity_available}
                onChange={e => setPrizeForm({ ...prizeForm, quantity_available: Number(e.target.value) })} />
            ) : (
              <input type="number" step="0.01" min="0" max="1" className={field} placeholder="Odds (0-1)" value={prizeForm.win_probability}
                onChange={e => setPrizeForm({ ...prizeForm, win_probability: Number(e.target.value) })} />
            )}
            <input type="number" className={field} placeholder="Cost (pesewas, 0 = free)" value={prizeForm.cost_pesewas}
              onChange={e => setPrizeForm({ ...prizeForm, cost_pesewas: Number(e.target.value) })} />
            <button onClick={() => void addPrize()} className="h-11 bg-ev-crimson text-[12px] font-semibold uppercase tracking-[0.16em] text-white sm:col-span-3">
              Add prize
            </button>
          </div>
          <p className="mt-2 text-[11px] text-ev-muted">
            Fixed count: a set number of winners drawn from the pool as tickets sell. Probability: each ticket has an independent chance to win, capped once the pool runs out.
          </p>
        </section>
      </main>
    </div>
  )
}
