'use client'

import { useCallback, useEffect, useState } from 'react'
import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { formatAmount } from '@evolveit/shared/money'
import { Wordmark } from '@/components/Wordmark'

interface Balance {
  status: string
  total_pesewas: number
  paid_pesewas: number
  balance_pesewas: number
  deadline_at: string | null
  settled: boolean
  lapsed: boolean
}

/**
 * Where a buyer settles the second half of an installment plan.
 *
 * The reminder text links straight here with the reference already in the URL,
 * so all the buyer has to add is the number they bought under.
 */
function BalancePageInner() {
  const params = useSearchParams()
  const ref = params.get('ref') ?? ''
  const [phone, setPhone] = useState('')
  const [bal, setBal] = useState<Balance | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const look = useCallback(async (p: string) => {
    setBusy(true); setErr('')
    const res = await fetch(`/api/checkout/balance?ref=${encodeURIComponent(ref)}&phone=${encodeURIComponent(p)}`)
    const d = await res.json() as Balance & { error?: string }
    if (!res.ok) { setErr(d.error ?? 'Could not find that plan.'); setBal(null) }
    else setBal(d)
    setBusy(false)
  }, [ref])

  useEffect(() => { if (!ref) setErr('That link is missing its reference.') }, [ref])

  async function pay() {
    setBusy(true); setErr('')
    const res = await fetch('/api/checkout/balance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reference: ref, phone }),
    })
    const d = await res.json() as { authorization_url?: string; settled?: boolean; error?: string }
    if (d.authorization_url) { window.location.href = d.authorization_url; return }
    if (d.settled) { await look(phone); setBusy(false); return }
    setErr(d.error ?? 'Could not raise that charge.')
    setBusy(false)
  }

  const due = bal?.deadline_at ? new Date(bal.deadline_at) : null

  return (
    <main className="relative min-h-screen overflow-hidden" data-tenant="memories-nc">
      <img src="/table.jpg" alt="" className="absolute inset-0 h-full w-full object-cover opacity-40" />
      <div className="absolute inset-0 bg-[#08070D]/80" />
      <div className="relative z-10 mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-12 text-[#F3EDE4]">
        <Wordmark href="/" size="sm" />

        {bal?.settled ? (
          <>
            <h1 className="mt-10 font-display text-[36px] leading-tight">Paid in full.</h1>
            <p className="mt-4 text-[15px] leading-relaxed text-[#C4B8A8]">
              Your pass is live. The link in your messages opens it at the door.
            </p>
          </>
        ) : bal?.lapsed ? (
          <>
            <h1 className="mt-10 font-display text-[36px] leading-tight">That hold has gone.</h1>
            <p className="mt-4 text-[15px] leading-relaxed text-[#C4B8A8]">
              The balance was not settled in time and the seats went back on sale. What you
              paid, less the 10% we keep, is on its way back to your wallet.
            </p>
          </>
        ) : (
          <>
            <h1 className="mt-10 font-display text-[36px] leading-tight">The other half.</h1>

            {!bal && (
              <>
                <p className="mt-4 text-[15px] leading-relaxed text-[#C4B8A8]">
                  Confirm the number you bought under and we will pull up what is left.
                </p>
                <input
                  type="tel"
                  inputMode="tel"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="024 412 3456"
                  className="mt-6 h-14 w-full border border-[#2A242C] bg-[#100E14] px-4 text-center text-[16px] text-[#F3EDE4] placeholder:text-[#6B6570] focus:outline-none"
                />
                <button
                  disabled={busy || phone.length < 9 || !ref}
                  onClick={() => void look(phone)}
                  className="mt-3 h-14 w-full border border-[#2A242C] text-[12px] uppercase tracking-[0.2em] text-[#C4B8A8] disabled:opacity-30"
                >
                  {busy ? 'Looking…' : 'Show my balance'}
                </button>
              </>
            )}

            {bal && (
              <>
                <p className="mt-8 text-[11px] uppercase tracking-[0.24em] text-[#8A8580]">Still to pay</p>
                <p className="mt-2 font-mono text-[48px] leading-none">{formatAmount(bal.balance_pesewas)}</p>
                <p className="mt-3 text-[13px] text-[#8A8580]">
                  of {formatAmount(bal.total_pesewas)} · {formatAmount(bal.paid_pesewas)} paid
                </p>
                {due && (
                  <p className="mt-5 border-l-2 border-[#E0A24A] py-2 pl-4 text-[13px] leading-relaxed text-[#C4B8A8]">
                    Due by {due.toLocaleString('en-GH', {
                      weekday: 'long', day: 'numeric', month: 'long',
                      hour: '2-digit', minute: '2-digit',
                    })}. After that the seats go back on sale and we keep 10%.
                  </p>
                )}
                <button
                  disabled={busy}
                  onClick={() => void pay()}
                  className="mt-6 h-14 w-full bg-ev-crimson text-[13px] font-semibold uppercase tracking-[0.22em] text-white disabled:opacity-30"
                >
                  {busy ? 'Opening MoMo…' : 'Pay the balance'}
                </button>
              </>
            )}
          </>
        )}

        {err && <p className="mt-5 text-[13px] text-ev-crimson">{err}</p>}
      </div>
    </main>
  )
}

/**
 * useSearchParams() opts the tree into client-side rendering, and Next refuses
 * to prerender it without a boundary. The build has never run in this repo —
 * next.config.ts is not a format Next 14 loads, so `next build` failed before
 * it got here — which is why this was never caught.
 */
export default function BalancePage() {
  return (
    <Suspense fallback={
      <main className="flex min-h-screen items-center justify-center bg-[#08070D]">
        <p className="text-[11px] uppercase tracking-[0.24em] text-[#8A8580]">Your balance</p>
      </main>
    }>
      <BalancePageInner />
    </Suspense>
  )
}
