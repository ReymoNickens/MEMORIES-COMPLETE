'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { formatAmount } from '@evolveit/shared/money'
import { normalisePhone } from '@evolveit/shared/phone'
import { PhoneInput, MoneyDisplay, Button } from '@evolveit/ui'

interface TicketTypeRow {
  id: string
  name: string
  description: string | null
  price_pesewas: number
  remaining: number
  allow_installments: boolean
}

export default function EventPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const [eventName, setEventName] = useState('')
  const [ticketTypes, setTicketTypes] = useState<TicketTypeRow[]>([])
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [buyerName, setBuyerName] = useState('')
  const [buyerPhone, setBuyerPhone] = useState('')
  const [buyerEmail, setBuyerEmail] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    void fetch(`/api/events/${params.id}`).then(r => r.json()).then(d => {
      setEventName(d.event?.name ?? '')
      setTicketTypes(d.event?.ticket_types ?? [])
    })
  }, [params.id])

  const totalQty = Object.values(quantities).reduce((s, n) => s + n, 0)
  const totalPesewas = ticketTypes.reduce((s, t) => s + t.price_pesewas * (quantities[t.id] ?? 0), 0)

  function setQty(id: string, delta: number) {
    setQuantities(prev => {
      const current = prev[id] ?? 0
      const next = Math.max(0, current + delta)
      if (totalQty - current + next > 6) return prev
      return { ...prev, [id]: next }
    })
  }

  async function pay() {
    setErr('')
    if (!normalisePhone(buyerPhone)) { setErr('Enter a valid Ghana number'); return }
    const selected = ticketTypes.filter(t => (quantities[t.id] ?? 0) > 0)
    if (selected.length === 0) { setErr('Select tickets'); return }
    if (selected.length > 1) { setErr('Please purchase one ticket type at a time'); return }
    const first = selected[0]!
    setLoading(true)
    const res = await fetch('/api/checkout/initiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticket_type_id: first.id,
        quantity: quantities[first.id],
        buyer_name: buyerName,
        buyer_phone: buyerPhone,
        buyer_email: buyerEmail,
      }),
    })
    const data = await res.json() as { authorization_url?: string; error?: string }
    setLoading(false)
    if (data.authorization_url) {
      window.location.href = data.authorization_url
    } else {
      setErr(data.error ?? 'Checkout failed')
    }
  }

  return (
    <main className="min-h-screen bg-ev-bg text-white px-5 py-8" data-tenant="memories-nc">
      <button onClick={() => router.push('/events')} className="text-micro text-ev-secondary mb-4">← Nights</button>
      <h1 className="font-display text-display-lg mb-6">{eventName}</h1>
      <div className="space-y-3 max-w-lg">
        {ticketTypes.map(t => (
          <div key={t.id} className="border border-ev-borderDark rounded-xl p-4 flex justify-between items-center">
            <div>
              <p className="font-semibold">{t.name}</p>
              <p className="text-ev-secondary text-body-md">{formatAmount(t.price_pesewas)} · {t.remaining} left</p>
            </div>
            <div className="flex items-center gap-3">
              <button className="w-10 h-10 border border-ev-borderDark rounded" onClick={() => setQty(t.id, -1)}>-</button>
              <span>{quantities[t.id] ?? 0}</span>
              <button className="w-10 h-10 border border-ev-borderDark rounded" onClick={() => setQty(t.id, 1)}>+</button>
            </div>
          </div>
        ))}
      </div>
      {totalQty > 0 && (
        <div className="max-w-lg mt-8 space-y-3">
          <input className="w-full h-12 rounded-lg px-3 text-ev-dark" placeholder="Full name" value={buyerName} onChange={e => setBuyerName(e.target.value)} />
          <PhoneInput value={buyerPhone} onChange={v => setBuyerPhone(v ?? '')} />
          <input className="w-full h-12 rounded-lg px-3 text-ev-dark" placeholder="Email" value={buyerEmail} onChange={e => setBuyerEmail(e.target.value)} />
          {err && <p className="text-ev-crimson text-body-md">{err}</p>}
          <Button variant="momo" size="lg" fullWidth loading={loading} onClick={() => void pay()}>
            Pay <MoneyDisplay pesewas={totalPesewas} className="mx-1" /> · MoMo
          </Button>
        </div>
      )}
    </main>
  )
}
