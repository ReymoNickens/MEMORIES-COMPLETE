'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { formatAmount } from '@evolveit/shared/money'
import { normalisePhone } from '@evolveit/shared/phone'

type Step = 'selection' | 'details' | 'payment'

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
  const [step, setStep] = useState<Step>('selection')
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [buyerName, setBuyerName] = useState('')
  const [buyerPhone, setBuyerPhone] = useState('')
  const [buyerEmail, setBuyerEmail] = useState('')
  const [phoneError, setPhoneError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  // In production: fetch from Supabase
  const ticketTypes: TicketTypeRow[] = []

  const totalQty = Object.values(quantities).reduce((s, n) => s + n, 0)

  function setQty(id: string, delta: number) {
    setQuantities(prev => {
      const current = prev[id] ?? 0
      const next = Math.max(0, current + delta)
      const newTotal = totalQty - current + next
      if (newTotal > 6) return prev
      return { ...prev, [id]: next }
    })
  }

  function validatePhone() {
    const norm = normalisePhone(buyerPhone)
    if (!norm) {
      setPhoneError('Enter a valid Ghana number (e.g. 0244 123 456)')
      return false
    }
    setPhoneError('')
    return true
  }

  async function handlePay() {
    if (!validatePhone()) return
    setIsLoading(true)

    const items = Object.entries(quantities)
      .filter(([, qty]) => qty > 0)
      .flatMap(([id, qty]) => Array.from({ length: qty }, () => ({ ticket_type_id: id })))

    if (items.length === 0) return

    try {
      const res = await fetch('/api/checkout/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticket_type_id: items[0]!.ticket_type_id,
          quantity: items.length,
          buyer_name: buyerName,
          buyer_phone: buyerPhone,
          buyer_email: buyerEmail,
        }),
      })
      const data = await res.json() as { authorization_url?: string }
      if (data.authorization_url) {
        window.location.href = data.authorization_url
      }
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-ev-page" data-tenant="memories-nc">
      <div className="max-w-lg mx-auto px-4 py-8">
        <h1 className="text-h1 text-ev-dark font-display mb-6">Get Tickets</h1>

        {step === 'selection' && (
          <div className="space-y-4">
            {ticketTypes.length === 0 && (
              <p className="text-body-md text-ev-muted text-center py-12">Loading tickets...</p>
            )}
            {ticketTypes.map(tt => (
              <div key={tt.id} className="bg-ev-card rounded-lg border border-ev-border p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-h3 text-ev-dark">{tt.name}</h3>
                    {tt.description && (
                      <p className="text-body-md text-ev-muted mt-1">{tt.description}</p>
                    )}
                    <p className="text-h2 text-ev-crimson mt-2 font-mono">
                      {formatAmount(tt.price_pesewas)}
                    </p>
                  </div>
                  {tt.remaining === 0 ? (
                    <span className="bg-ev-error-bg text-ev-error text-label px-3 py-1 rounded-full uppercase tracking-wide">
                      Sold Out
                    </span>
                  ) : (
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setQty(tt.id, -1)}
                        className="w-10 h-10 rounded-full border border-ev-border flex items-center justify-center text-h2 text-ev-dark min-h-tap min-w-tap"
                        aria-label="Decrease"
                      >
                        −
                      </button>
                      <span className="text-h2 text-ev-dark w-6 text-center font-mono">
                        {quantities[tt.id] ?? 0}
                      </span>
                      <button
                        onClick={() => setQty(tt.id, +1)}
                        disabled={(quantities[tt.id] ?? 0) >= tt.remaining}
                        className="w-10 h-10 rounded-full border border-ev-border flex items-center justify-center text-h2 text-ev-dark min-h-tap min-w-tap disabled:opacity-40"
                        aria-label="Increase"
                      >
                        +
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}

            <button
              onClick={() => setStep('details')}
              disabled={totalQty === 0}
              className="w-full h-14 bg-ev-crimson text-white text-h3 rounded-lg disabled:opacity-40 mt-4 min-h-tap-lg"
            >
              Continue ({totalQty} ticket{totalQty !== 1 ? 's' : ''})
            </button>
          </div>
        )}

        {step === 'details' && (
          <div className="space-y-4">
            <div>
              <label className="text-label text-ev-muted uppercase tracking-wide block mb-1">Full Name</label>
              <input
                type="text"
                value={buyerName}
                onChange={e => setBuyerName(e.target.value)}
                className="w-full h-12 border border-ev-border rounded-lg px-4 text-body-lg text-ev-dark focus:outline-none focus:border-ev-crimson"
                placeholder="Your full name"
              />
            </div>

            <div>
              <label className="text-label text-ev-muted uppercase tracking-wide block mb-1">Phone Number</label>
              <div className="flex items-center border border-ev-border rounded-lg overflow-hidden focus-within:border-ev-crimson">
                <span className="px-3 text-body-md text-ev-muted bg-gray-50 h-12 flex items-center border-r border-ev-border">
                  🇬🇭 +233
                </span>
                <input
                  type="tel"
                  value={buyerPhone}
                  onChange={e => setBuyerPhone(e.target.value)}
                  onBlur={validatePhone}
                  className="flex-1 h-12 px-3 text-body-lg text-ev-dark focus:outline-none"
                  placeholder="024 412 3456"
                />
              </div>
              {phoneError && <p className="text-label text-ev-error mt-1">{phoneError}</p>}
            </div>

            <div>
              <label className="text-label text-ev-muted uppercase tracking-wide block mb-1">Email</label>
              <input
                type="email"
                value={buyerEmail}
                onChange={e => setBuyerEmail(e.target.value)}
                className="w-full h-12 border border-ev-border rounded-lg px-4 text-body-lg text-ev-dark focus:outline-none focus:border-ev-crimson"
                placeholder="your@email.com"
              />
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setStep('selection')}
                className="flex-1 h-14 border border-ev-border text-ev-dark text-h3 rounded-lg min-h-tap-lg"
              >
                Back
              </button>
              <button
                onClick={() => {
                  if (!buyerName || !buyerEmail || !validatePhone()) return
                  setStep('payment')
                }}
                className="flex-1 h-14 bg-ev-crimson text-white text-h3 rounded-lg min-h-tap-lg"
              >
                Review
              </button>
            </div>
          </div>
        )}

        {step === 'payment' && (
          <div className="space-y-4">
            <div className="bg-ev-card rounded-lg border border-ev-border p-4 space-y-2">
              <h3 className="text-h3 text-ev-dark">Order Summary</h3>
              <p className="text-body-md text-ev-muted">{buyerName}</p>
              <p className="text-body-md text-ev-muted">{buyerPhone}</p>
              <p className="text-body-md text-ev-muted">{buyerEmail}</p>
            </div>

            <button
              onClick={handlePay}
              disabled={isLoading}
              className="w-full h-14 bg-ev-momo text-ev-dark text-h3 rounded-lg min-h-tap-lg font-semibold disabled:opacity-50"
            >
              {isLoading ? 'Redirecting to payment...' : 'Pay with MoMo'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
