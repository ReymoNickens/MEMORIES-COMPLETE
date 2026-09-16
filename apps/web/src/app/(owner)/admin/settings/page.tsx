'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Wordmark } from '@/components/Wordmark'

interface Settings {
  default_gate_price_pesewas: number
  default_table_price_pesewas: number
  contact_whatsapp: string | null
  contact_email: string | null
  contact_address: string | null
  tagline: string | null
  social_links: Record<string, string>
}

const field = 'h-11 w-full border border-ev-border bg-ev-bg px-3 text-[14px] text-ev-primary outline-none focus:border-ev-crimson'
const label = 'text-[11px] uppercase tracking-[0.16em] text-ev-muted'

export default function VenueSettingsPage() {
  const [s, setS] = useState<Settings | null>(null)
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    void (async () => {
      const res = await fetch('/api/admin/settings', { cache: 'no-store' })
      if (res.status === 401 || res.status === 403) { window.location.href = '/staff/login'; return }
      const j = await res.json() as { settings?: Settings; error?: string }
      if (j.error) { setErr(j.error); return }
      setS(j.settings ?? null)
    })()
  }, [])

  async function save() {
    if (!s) return
    setErr('')
    setSaved(false)
    const res = await fetch('/api/admin/settings', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s),
    })
    const j = await res.json() as { error?: string }
    if (j.error) { setErr(j.error); return }
    setSaved(true)
  }

  if (!s) {
    return <div className="min-h-screen bg-ev-bg text-ev-primary"><p className="px-6 py-16 text-center text-[14px] text-ev-muted">{err || 'Loading…'}</p></div>
  }

  return (
    <div className="min-h-screen bg-ev-bg text-ev-primary">
      <header className="flex items-center justify-between border-b border-ev-border px-6 py-5">
        <Wordmark href="/" size="sm" />
        <Link href="/admin" className="text-[11px] uppercase tracking-[0.18em] text-ev-muted hover:text-ev-primary">← Events</Link>
      </header>

      <main className="mx-auto max-w-xl px-6 py-8">
        <h1 className="font-display text-h1">Venue settings</h1>
        <p className="mt-1 text-[13px] text-ev-muted">
          Standing information used across the site and as the starting point for a new event's pricing.
        </p>
        {err && <p className="mt-4 border-l-2 border-ev-crimson pl-4 text-[13px] text-ev-crimson">{err}</p>}
        {saved && <p className="mt-4 border-l-2 border-[#7DCF8A] pl-4 text-[13px] text-[#7DCF8A]">Saved.</p>}

        <div className="mt-6 grid gap-4">
          <div className="grid grid-cols-2 gap-4">
            <label className="grid gap-1"><span className={label}>Default gate price (pesewas)</span>
              <input type="number" className={field} value={s.default_gate_price_pesewas}
                onChange={e => setS({ ...s, default_gate_price_pesewas: Number(e.target.value) })} /></label>
            <label className="grid gap-1"><span className={label}>Default table price (pesewas)</span>
              <input type="number" className={field} value={s.default_table_price_pesewas}
                onChange={e => setS({ ...s, default_table_price_pesewas: Number(e.target.value) })} /></label>
          </div>

          <label className="grid gap-1"><span className={label}>Tagline</span>
            <input className={field} value={s.tagline ?? ''} onChange={e => setS({ ...s, tagline: e.target.value })} /></label>

          <label className="grid gap-1"><span className={label}>WhatsApp / booking number</span>
            <input className={field} value={s.contact_whatsapp ?? ''} onChange={e => setS({ ...s, contact_whatsapp: e.target.value })} /></label>
          <label className="grid gap-1"><span className={label}>Contact email</span>
            <input className={field} value={s.contact_email ?? ''} onChange={e => setS({ ...s, contact_email: e.target.value })} /></label>
          <label className="grid gap-1"><span className={label}>Address</span>
            <input className={field} value={s.contact_address ?? ''} onChange={e => setS({ ...s, contact_address: e.target.value })} /></label>

          <div className="grid grid-cols-2 gap-4">
            {['instagram', 'tiktok', 'twitter', 'facebook'].map(platform => (
              <label key={platform} className="grid gap-1">
                <span className={label}>{platform}</span>
                <input className={field} value={s.social_links[platform] ?? ''}
                  onChange={e => setS({ ...s, social_links: { ...s.social_links, [platform]: e.target.value } })} />
              </label>
            ))}
          </div>

          <button onClick={() => void save()} className="mt-2 h-12 bg-ev-crimson text-[13px] font-semibold uppercase tracking-[0.2em] text-white">
            Save
          </button>
        </div>
      </main>
    </div>
  )
}
