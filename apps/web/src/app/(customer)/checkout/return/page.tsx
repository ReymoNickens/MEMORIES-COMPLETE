'use client'
import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'

export default function CheckoutReturnPage() {
  const params = useSearchParams()
  const router = useRouter()
  const ref = params.get('ref')
  const demo = params.get('demo') === '1'
  const [msg, setMsg] = useState(demo ? 'Demo rail — confirm to issue tickets' : 'Waiting for payment confirmation…')
  const [tickets, setTickets] = useState<string[]>([])

  async function confirmDemo() {
    setMsg('Issuing tickets…')
    const res = await fetch('/api/checkout/initiate', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reference: ref }),
    })
    const data = await res.json() as { ticket_ids?: string[]; access_tokens?: string[]; error?: string }
    if (data.ticket_ids?.[0] && data.access_tokens?.[0]) {
      const id = data.ticket_ids[0]
      sessionStorage.setItem(`ticket-access-${id}`, data.access_tokens[0])
      setTickets(data.ticket_ids)
      setMsg('Issued')
      router.push(`/tickets/${id}?access=${data.access_tokens[0]}`)
    } else {
      setMsg(data.error ?? 'Issue failed')
    }
  }

  useEffect(() => {
    if (!ref || demo) return
    const t = setInterval(async () => {
      const res = await fetch(`/api/tickets/status?ref=${ref}`)
      const data = await res.json() as { issued?: boolean; ticket_ids?: string[] }
      if (data.issued && data.ticket_ids?.[0]) {
        clearInterval(t)
        setTickets(data.ticket_ids)
        setMsg('Issued')
      }
    }, 2000)
    return () => clearInterval(t)
  }, [ref, demo])

  return (
    <main className="min-h-screen bg-ev-bg text-white flex flex-col items-center justify-center px-6" data-tenant="memories-nc">
      <h1 className="font-display text-h1 mb-4">Checkout</h1>
      <p className="text-ev-secondary mb-6">{msg}</p>
      {demo && <button onClick={() => void confirmDemo()} className="h-14 px-8 rounded-lg bg-ev-crimson">Confirm demo MoMo</button>}
      {tickets.length > 0 && <p className="text-micro mt-4">{tickets.length} ticket(s)</p>}
    </main>
  )
}
