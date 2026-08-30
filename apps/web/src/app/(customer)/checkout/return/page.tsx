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

  useEffect(() => {
    if (!ref || demo) return
    const t = setInterval(async () => {
      const res = await fetch(`/api/tickets/status?ref=${ref}`)
      const data = await res.json() as { issued?: boolean; ticket_ids?: string[] }
      if (data.issued && data.ticket_ids?.[0]) {
        clearInterval(t)
        setMsg('Your night is ready.')
      }
    }, 2000)
    return () => clearInterval(t)
  }, [ref, demo])

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
      </div>
    </main>
  )
}
