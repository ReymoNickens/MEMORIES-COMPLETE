'use client'

import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Wordmark } from '@/components/Wordmark'

export default function CheckoutReturnPage() {
  const params = useSearchParams()
  const router = useRouter()
  const ref = params.get('ref')
  const demo = params.get('demo') === '1'
  const [msg, setMsg] = useState(demo
    ? 'MoMo is confirmed on this demo rail. Press to print the door pass.'
    : 'Waiting for MoMo. Do not close this page.')
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState<'waiting' | 'claim' | 'failed'>(demo ? 'claim' : 'waiting')
  const [phone, setPhone] = useState('')
  const [err, setErr] = useState('')

  async function confirmDemo() {
    setBusy(true)
    setMsg('Cutting the ticket…')
    const res = await fetch('/api/checkout/initiate', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reference: ref }),
    })
    const data = await res.json() as { ticket_ids?: string[]; access_tokens?: string[]; error?: string }
    if (data.ticket_ids?.[0] && data.access_tokens?.[0]) {
      const id = data.ticket_ids[0]
      sessionStorage.setItem(`ticket-access-${id}`, data.access_tokens[0])
      router.push(`/tickets/${id}?access=${data.access_tokens[0]}`)
    } else {
      setBusy(false)
      setMsg(data.error ?? 'The ticket did not print. Try again.')
    }
  }

  // The live rail used to poll until the tickets existed, set a hopeful
  // message and stop — the buyer never reached their pass. The raw access
  // token only ever exists in the process that issued the tickets, and when
  // the webhook issues them that is not this browser, so the buyer claims a
  // fresh grant with the reference plus the number they bought under.
  useEffect(() => {
    if (!ref || demo) return
    let cancelled = false
    const t = setInterval(async () => {
      const res = await fetch(`/api/tickets/status?ref=${ref}`)
      const data = await res.json() as { issued?: boolean; failed?: boolean; ticket_ids?: string[] }
      if (cancelled) return
      if (data.failed) {
        clearInterval(t)
        setStage('failed')
        setMsg('That charge did not complete. Nothing has been taken — if money left your wallet, show this page at the door.')
        return
      }
      if (data.issued && data.ticket_ids?.[0]) {
        clearInterval(t)
        setStage('claim')
        setMsg('Paid. Confirm the number you bought under and we will open your pass.')
      }
    }, 2000)
    return () => { cancelled = true; clearInterval(t) }
  }, [ref, demo])

  async function claim() {
    setBusy(true)
    setErr('')
    const res = await fetch('/api/tickets/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reference: ref, phone }),
    })
    const data = await res.json() as {
      tickets?: Array<{ id: string; access: string }>; error?: string
    }
    if (!res.ok || !data.tickets?.[0]) {
      setErr(data.error ?? 'Could not open that pass.')
      setBusy(false)
      return
    }
    // Keep every pass in the batch, so a buyer who bought four can walk four
    // people in from one phone.
    for (const t of data.tickets) {
      sessionStorage.setItem(`ticket-access-${t.id}`, t.access)
    }
    const first = data.tickets[0]!
    router.push(`/tickets/${first.id}?access=${first.access}`)
  }

  return (
    <main className="relative min-h-screen overflow-hidden" data-tenant="memories-nc">
      <img src="/table.jpg" alt="" className="absolute inset-0 h-full w-full object-cover opacity-50" />
      <div className="absolute inset-0 bg-[#08070D]/70" />
      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-6 text-center">
        <Wordmark href="/" size="sm" />
        <h1 className="mt-10 font-display text-[36px] leading-tight">The till</h1>
        <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-[#C4B8A8]">{msg}</p>
        {demo && (
          <button
            disabled={busy}
            onClick={() => void confirmDemo()}
            className="mt-8 h-14 px-8 bg-ev-momo text-[13px] font-semibold uppercase tracking-[0.18em] text-[#14090B]"
          >
            {busy ? 'Printing…' : 'Confirm MoMo'}
          </button>
        )}

        {!demo && stage === 'waiting' && (
          <div className="mt-8 h-[2px] w-40 overflow-hidden bg-[#2A242C]">
            <div className="h-full w-1/3 animate-pulse bg-ev-crimson" />
          </div>
        )}

        {!demo && stage === 'claim' && (
          <div className="mt-8 w-full max-w-xs">
            <input
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="024 412 3456"
              className="h-14 w-full border border-[#2A242C] bg-[#100E14] px-4 text-center text-[16px] text-[#F3EDE4] placeholder:text-[#6B6570] focus:outline-none"
            />
            {err && <p className="mt-3 text-[13px] text-ev-crimson">{err}</p>}
            <button
              disabled={busy || phone.length < 9}
              onClick={() => void claim()}
              className="mt-3 h-14 w-full bg-ev-crimson text-[13px] font-semibold uppercase tracking-[0.2em] text-white disabled:opacity-30"
            >
              {busy ? 'Opening…' : 'Open my pass'}
            </button>
            <p className="mt-4 text-[12px] leading-relaxed text-[#6B6570]">
              Keep this link. It is how you get back to your pass on the night.
            </p>
          </div>
        )}
      </div>
    </main>
  )
}
