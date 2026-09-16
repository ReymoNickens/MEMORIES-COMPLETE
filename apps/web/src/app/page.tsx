'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Wordmark } from '@/components/Wordmark'
import { formatAmount } from '@evolveit/shared/money'

interface VenueSettings {
  default_gate_price_pesewas: number
  default_table_price_pesewas: number
  contact_whatsapp: string | null
  contact_email: string | null
  contact_address: string | null
  tagline: string | null
  social_links: Record<string, string>
}

interface EventRow {
  id: string
  name: string
  description: string | null
  starts_at: string
  ticket_types: Array<{ price_pesewas: number; remaining: number }>
}

const label = 'text-[11px] uppercase tracking-[0.28em] text-ev-crimson'
const field = 'h-11 w-full border border-[#2A242C] bg-[#100E14] px-3 text-[14px] text-[#F3EDE4] outline-none focus:border-ev-crimson placeholder:text-[#6B6570]'

// Content ported from the legacy marketing site (ReymoNickens/MEMORIES-NIGHT-CLUB)
// per the build brief's Section 9 — the copy and structure below (the "some
// nights are forever" framing, the table tiers, the host-an-event pitch) are
// the legacy site's real language, brought onto this app's own visual system
// rather than its markup. The palette and type stay this codebase's own
// (ev-* tokens, Instrument Serif/Manrope) — ENGINEERS.md is explicit that a
// second, competing palette is a bug this repo already paid down once, not
// something to reintroduce for the sake of a pixel match.
export default function HomePage() {
  const [settings, setSettings] = useState<VenueSettings | null>(null)
  const [events, setEvents] = useState<EventRow[]>([])

  useEffect(() => {
    void fetch('/api/venue-settings').then(r => r.json()).then(d => setSettings(d.settings ?? null))
    void fetch('/api/events').then(r => r.json()).then(d => setEvents((d.events ?? []).slice(0, 3)))
  }, [])

  const whatsapp = settings?.contact_whatsapp
  const whatsappHref = whatsapp ? `tel:${whatsapp.replace(/\s/g, '')}` : undefined

  return (
    <div data-tenant="memories-nc">
      {/* HERO */}
      <main className="relative min-h-screen overflow-hidden mnc-grain">
        <img src="/room.jpg" alt="" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 mnc-veil" />
        <div className="relative z-10 flex min-h-screen flex-col justify-between px-6 pb-8 pt-8">
          <p className="text-[11px] uppercase tracking-[0.32em] text-[#C4B8A8]">
            SamRit Hotel · Cape Coast, Ghana
          </p>

          <div className="max-w-lg">
            <Wordmark href={null} size="hero" />
            <p className="mt-6 font-display text-[28px] italic leading-tight text-[#F3EDE4] sm:text-[34px]">
              {settings?.tagline || 'You came for a night. You stayed for the story.'}
            </p>
            <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-[#C4B8A8]">
              Friday and Saturday. Doors 10PM. No velvet rope — the room is the room.
              Do not wait for the gate price.
            </p>
          </div>

          <div className="max-w-sm">
            <Link
              href="/events"
              className="flex h-14 items-center justify-center bg-ev-crimson text-[13px] font-semibold uppercase tracking-[0.22em] text-white"
            >
              Secure your night
            </Link>
            <p className="mt-4 text-[11px] uppercase tracking-[0.2em] text-[#8A8580]">
              Afrobeats · Amapiano · Afro house
            </p>
          </div>
        </div>
      </main>

      {/* ABOUT */}
      <section id="about" className="bg-[#100F18] px-6 py-20">
        <div className="mx-auto max-w-2xl">
          <p className={label}>The only one of its kind</p>
          <h2 className="mt-3 font-display text-[32px] leading-tight text-[#F3EDE4] sm:text-[40px]">
            Cape Coast finally has <em className="text-ev-crimson not-italic">the night it deserves</em>
          </h2>
          <div className="mt-5 h-px w-11 bg-ev-crimson" />
          <p className="mt-5 max-w-lg text-[14px] leading-relaxed text-[#8A8580]">
            The best DJs in the region. A crowd that came to actually enjoy themselves.
            A floor that does not lie. And one rule above all: some nights are forever
            — this is one of them.
          </p>
          <ul className="mt-6 max-w-lg space-y-3">
            {[
              "Ghana's coast, curated — Afrobeats, Amapiano, Afro house, hip-hop, all in one room",
              'No velvet rope theatre — book a table and own your night legitimately',
              'Dedicated smokers area so the floor stays clean and the energy stays up',
              'Security that protects the vibe, not just the door',
              'Strict dress code — because the room you walk into should feel like it means something',
            ].map(line => (
              <li key={line} className="flex items-start gap-3 border-b border-[#2A242C] pb-3 text-[13px] leading-relaxed text-[#8A8580]">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ev-crimson" />
                {line}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* WHAT'S ON */}
      <section id="events" className="bg-[#08070D] px-6 py-20">
        <div className="mx-auto max-w-2xl">
          <p className={label}>Secure your spot</p>
          <h2 className="mt-3 font-display text-[32px] leading-tight text-[#F3EDE4] sm:text-[40px]">
            Do not wait for <em className="text-ev-crimson not-italic">the gate price</em>
          </h2>
          <p className="mt-4 max-w-md text-[14px] leading-relaxed text-[#8A8580]">
            Advance tickets sell out. The crowd you want to be part of buys ahead.
            Get in, skip the queue, pay less. Simple.
          </p>

          <div className="mt-8 space-y-3">
            {events.map(ev => {
              const from = ev.ticket_types?.length
                ? Math.min(...ev.ticket_types.map(t => t.price_pesewas))
                : null
              return (
                <Link
                  key={ev.id}
                  href={`/events/${ev.id}`}
                  className="flex items-center justify-between border border-[#2A242C] bg-[#16141F] px-5 py-4 hover:border-ev-crimson"
                >
                  <div>
                    <p className="font-display text-[20px] leading-tight text-[#F3EDE4]">{ev.name}</p>
                    <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-[#8A8580]">
                      {new Date(ev.starts_at).toLocaleString('en-GH', { weekday: 'short', day: 'numeric', month: 'short' })}
                    </p>
                  </div>
                  {from != null && <p className="font-mono text-[15px] text-ev-crimson">From {formatAmount(from)}</p>}
                </Link>
              )
            })}
            {events.length === 0 && (
              <p className="border border-[#2A242C] px-5 py-8 text-center text-[13px] text-[#8A8580]">
                The next night has not been posted yet.
              </p>
            )}
          </div>

          {whatsappHref && (
            <div className="mt-8 border border-[#2A242C] px-6 py-6 text-center">
              <p className={label}>To purchase tickets</p>
              <p className="mt-3 text-[13px] leading-relaxed text-[#8A8580]">
                Call or WhatsApp us directly. Quote the event name and your number of tickets.
              </p>
              <a href={whatsappHref} className="mt-4 inline-block bg-ev-crimson px-6 py-3 text-[13px] font-semibold uppercase tracking-[0.18em] text-white">
                {whatsapp}
              </a>
            </div>
          )}
        </div>
      </section>

      {/* TABLES */}
      <section id="tables" className="bg-[#100F18] px-6 py-20 text-center">
        <div className="mx-auto max-w-xl">
          <p className={label}>Seating at Memories</p>
          <h2 className="mt-3 font-display text-[32px] leading-tight text-[#F3EDE4] sm:text-[40px]">
            A table is a <em className="text-ev-crimson not-italic">privilege, not a right</em>
          </h2>
          <p className="mt-4 font-display text-[18px] italic leading-relaxed text-[#8A8580]">
            "There is no VIP lounge. There is just the room — and those who chose to own their corner of it."
          </p>
          <div className="mt-8 grid gap-px bg-[#2A242C] sm:grid-cols-3">
            {[
              { name: 'Standard table', body: 'Reserved seating for your group with bottle service. Priority entry. Dedicated floor host.' },
              { name: 'Premium table', body: 'Floor-side position with the best sightlines in the venue. Multiple bottles.' },
              { name: 'Birthday package', body: 'Décor, dedicated host, a special mention from the DJ, bottles ready. You just show up.' },
            ].map(t => (
              <div key={t.name} className="bg-[#100F18] px-6 py-8 text-left">
                <p className="font-display text-[18px] text-[#F3EDE4]">{t.name}</p>
                <p className="mt-2 text-[13px] leading-relaxed text-[#8A8580]">{t.body}</p>
              </div>
            ))}
          </div>
          {settings && settings.default_table_price_pesewas > 0 && (
            <p className="mt-6 text-[12px] uppercase tracking-[0.18em] text-[#8A8580]">
              Tables from {formatAmount(settings.default_table_price_pesewas)}
            </p>
          )}
          {whatsappHref && (
            <a href={whatsappHref} className="mt-6 inline-block bg-ev-crimson px-6 py-3 text-[13px] font-semibold uppercase tracking-[0.18em] text-white">
              Book a table now
            </a>
          )}
        </div>
      </section>

      {/* HOST YOUR EVENT */}
      <HostYourEvent whatsappHref={whatsappHref} />

      {/* VISIT */}
      <section id="visit" className="bg-[#100F18] px-6 py-20">
        <div className="mx-auto max-w-md text-center">
          <p className={label}>Find us</p>
          <h2 className="mt-3 font-display text-[28px] leading-tight text-[#F3EDE4]">
            SamRit Hotel, Cape Coast
          </h2>
          {settings?.contact_address && (
            <p className="mt-3 text-[13px] text-[#8A8580]">{settings.contact_address}</p>
          )}
          <p className="mt-4 text-[13px] text-[#8A8580]">Friday &amp; Saturday · Doors 10PM</p>
          {settings?.contact_email && (
            <p className="mt-2 text-[12px] uppercase tracking-[0.14em] text-[#8A8580]">{settings.contact_email}</p>
          )}
          {settings?.social_links && Object.keys(settings.social_links).length > 0 && (
            <div className="mt-6 flex justify-center gap-5 text-[11px] uppercase tracking-[0.18em] text-ev-crimson">
              {Object.entries(settings.social_links).filter(([, url]) => url).map(([platform, url]) => (
                <a key={platform} href={url} target="_blank" rel="noreferrer">{platform}</a>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function HostYourEvent({ whatsappHref }: { whatsappHref: string | undefined }) {
  const [form, setForm] = useState({
    organiser_name: '', contact_person: '', contact_email: '', contact_phone: '',
    event_name: '', preferred_date: '', estimated_attendance: 150, concept: '',
  })
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)

  async function submit() {
    setBusy(true)
    setResult(null)
    const res = await fetch('/api/public/event-proposals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const j = await res.json() as { ok?: boolean; error?: string }
    setBusy(false)
    if (!j.ok) { setResult({ tone: 'err', text: j.error ?? 'Could not submit — try again.' }); return }
    setResult({ tone: 'ok', text: 'Proposal received. We review every submission and reach out within 48 hours.' })
    setForm({ organiser_name: '', contact_person: '', contact_email: '', contact_phone: '', event_name: '', preferred_date: '', estimated_attendance: 150, concept: '' })
  }

  return (
    <section id="host" className="bg-[#08070D] px-6 py-20">
      <div className="mx-auto max-w-lg">
        <p className={label}>For event organisers</p>
        <h2 className="mt-3 font-display text-[32px] leading-tight text-[#F3EDE4] sm:text-[40px]">
          Host your event where <em className="text-ev-crimson not-italic">Cape Coast actually shows up</em>
        </h2>
        <p className="mt-4 text-[14px] leading-relaxed text-[#8A8580]">
          Memories is Cape Coast's most active event floor. We provide the venue, the sound,
          the floor and the crowd infrastructure. You bring the vision.
        </p>

        {result && (
          <p className={`mt-6 border-l-2 pl-4 text-[13px] ${result.tone === 'ok' ? 'border-[#7DCF8A] text-[#7DCF8A]' : 'border-ev-crimson text-ev-crimson'}`}>
            {result.text}
          </p>
        )}

        <div className="mt-6 grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <input className={field} placeholder="Organiser / company name" value={form.organiser_name} onChange={e => setForm({ ...form, organiser_name: e.target.value })} />
            <input className={field} placeholder="Contact person" value={form.contact_person} onChange={e => setForm({ ...form, contact_person: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input className={field} placeholder="Email" value={form.contact_email} onChange={e => setForm({ ...form, contact_email: e.target.value })} />
            <input className={field} placeholder="Phone / WhatsApp" value={form.contact_phone} onChange={e => setForm({ ...form, contact_phone: e.target.value })} />
          </div>
          <input className={field} placeholder="Event name" value={form.event_name} onChange={e => setForm({ ...form, event_name: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <input type="date" className={field} value={form.preferred_date} onChange={e => setForm({ ...form, preferred_date: e.target.value })} />
            <input type="number" className={field} placeholder="Est. attendance" value={form.estimated_attendance} onChange={e => setForm({ ...form, estimated_attendance: Number(e.target.value) })} />
          </div>
          <textarea
            className="min-h-[100px] border border-[#2A242C] bg-[#100E14] p-3 text-[14px] text-[#F3EDE4] outline-none focus:border-ev-crimson placeholder:text-[#6B6570]"
            placeholder="Tell us what makes this night different — theme, target crowd, the energy you're going for"
            value={form.concept}
            onChange={e => setForm({ ...form, concept: e.target.value })}
          />
          <button
            disabled={busy}
            onClick={() => void submit()}
            className="h-14 bg-ev-crimson text-[13px] font-semibold uppercase tracking-[0.22em] text-white disabled:opacity-60"
          >
            {busy ? 'Sending…' : 'Submit proposal'}
          </button>
          <p className="text-[11px] leading-relaxed text-[#6B6570]">
            Available dates are Fridays and Saturdays only. We review every submission before any date is confirmed.
            {whatsappHref && <> Prefer to talk first? <a href={whatsappHref} className="underline">Call or WhatsApp us</a>.</>}
          </p>
        </div>
      </div>
    </section>
  )
}
