'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Wordmark } from '@/components/Wordmark'

export default function StaffLoginPage() {
  const router = useRouter()
  const [phone, setPhone] = useState('')
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setErr('')
    setBusy(true)
    const res = await fetch('/api/staff/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, pin }),
    })
    const data = await res.json() as { error?: string }
    if (!res.ok) {
      setBusy(false)
      setErr(data.error ?? 'That PIN does not open the house.')
      return
    }
    router.push('/staff/claim')
  }

  function press(d: string) {
    if (d === 'C') { setPin(''); return }
    if (d === '⌫') { setPin(p => p.slice(0, -1)); return }
    setPin(p => (p.length >= 6 ? p : p + d))
  }

  return (
    <main className="relative min-h-screen overflow-hidden" data-tenant="memories-nc">
      <img src="/table.jpg" alt="" className="absolute inset-0 h-full w-full object-cover opacity-35" />
      <div className="absolute inset-0 bg-[#08070D]/80" />
      <div className="relative z-10 mx-auto flex min-h-screen max-w-sm flex-col justify-between px-6 py-10">
        <div>
          <Wordmark href="/" size="md" />
          <p className="mt-3 text-[11px] uppercase tracking-[0.28em] text-[#8A8580]">Working tonight</p>
        </div>

        <div>
          <input
            className="h-14 w-full border border-[#2A242C] bg-[#100E14] px-4 text-[#F3EDE4] placeholder:text-[#6B6570]"
            placeholder="Your number"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            inputMode="tel"
          />
          <p className="mt-6 text-center font-mono text-[32px] tracking-[0.4em] text-[#F3EDE4]">
            {pin ? '•'.repeat(pin.length) : 'PIN'}
          </p>
          <div className="mt-6 grid grid-cols-3 gap-2">
            {['1','2','3','4','5','6','7','8','9','C','0','⌫'].map(d => (
              <button
                key={d}
                onClick={() => press(d)}
                className="h-16 border border-[#2A242C] bg-[#100E14] text-[20px] text-[#F3EDE4]"
              >
                {d}
              </button>
            ))}
          </div>
          {err && <p className="mt-4 text-center text-[13px] text-ev-crimson">{err}</p>}
        </div>

        <button
          disabled={busy || pin.length < 4}
          onClick={() => void submit()}
          className="h-14 bg-ev-crimson text-[13px] font-semibold uppercase tracking-[0.22em] text-white disabled:opacity-40"
        >
          {busy ? 'Opening…' : 'Enter the house'}
        </button>
      </div>
    </main>
  )
}
