'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PhoneInput, Button } from '@evolveit/ui'

export default function StaffLoginPage() {
  const router = useRouter()
  const [phone, setPhone] = useState('')
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit() {
    setErr('')
    setLoading(true)
    const res = await fetch('/api/staff/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, pin }),
    })
    const data = await res.json() as { error?: string }
    setLoading(false)
    if (!res.ok) { setErr(data.error ?? 'Login failed'); return }
    router.push('/staff/claim')
  }

  return (
    <main className="min-h-screen bg-ev-page flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl p-6 border border-ev-border">
        <h1 className="font-display text-h1 mb-1">Staff sign in</h1>
        <p className="text-body-md text-ev-muted mb-6">Phone + station PIN</p>
        <div className="mb-3">
          <PhoneInput value={phone} onChange={v => setPhone(v ?? '')} error={undefined} />
        </div>
        <input className="w-full h-12 border rounded-lg px-3 mb-3" placeholder="PIN" type="password" value={pin} onChange={e => setPin(e.target.value)} />
        {err && <p className="text-ev-crimson text-body-md mb-3">{err}</p>}
        <Button variant="primary" size="lg" fullWidth loading={loading} onClick={() => void submit()}>Continue</Button>
        <p className="text-micro text-ev-muted mt-4">Demo: owner +233547180023 PIN 1111</p>
      </div>
    </main>
  )
}
