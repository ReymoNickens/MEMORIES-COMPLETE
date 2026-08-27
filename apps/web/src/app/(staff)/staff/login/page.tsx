'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function StaffLoginPage() {
  const router = useRouter()
  const [phone, setPhone] = useState('')
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')

  async function submit() {
    setErr('')
    const res = await fetch('/api/staff/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, pin }),
    })
    const data = await res.json() as { error?: string }
    if (!res.ok) { setErr(data.error ?? 'Login failed'); return }
    router.push('/staff/claim')
  }

  return (
    <main className="min-h-screen bg-ev-page flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl p-6 border border-ev-border">
        <h1 className="font-display text-h1 mb-1">Staff sign in</h1>
        <p className="text-body-md text-ev-muted mb-6">Phone + station PIN</p>
        <input className="w-full h-12 border rounded-lg px-3 mb-3" placeholder="0244 123 456" value={phone} onChange={e => setPhone(e.target.value)} />
        <input className="w-full h-12 border rounded-lg px-3 mb-3" placeholder="PIN" type="password" value={pin} onChange={e => setPin(e.target.value)} />
        {err && <p className="text-ev-crimson text-body-md mb-3">{err}</p>}
        <button onClick={() => void submit()} className="w-full h-12 rounded-lg bg-ev-crimson text-white font-semibold">Continue</button>
        <p className="text-micro text-ev-muted mt-4">Demo: owner +233547180023 PIN 1111</p>
      </div>
    </main>
  )
}
