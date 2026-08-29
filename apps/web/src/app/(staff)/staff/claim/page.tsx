'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Wordmark } from '@/components/Wordmark'

const DEST: Record<string, string> = {
  door: '/scanner',
  bar: '/bar',
  kitchen: '/kitchen',
  floor: '/floor',
  cashier: '/dashboard',
}

const KIND: Record<string, string> = {
  door: 'The door',
  bar: 'The bar',
  kitchen: 'The kitchen',
  floor: 'The floor',
  cashier: 'The till',
}

export default function ClaimPage() {
  const router = useRouter()
  const [stations, setStations] = useState<Array<{ kind: string; label: string }>>([])
  const [name, setName] = useState('')

  useEffect(() => {
    void fetch('/api/staff/me').then(r => {
      if (r.status === 401) router.push('/staff/login')
      return r.json()
    }).then(d => {
      setName(d.session?.full_name ?? '')
      setStations(d.stations ?? [])
    })
  }, [router])

  async function claim(kind: string, label: string) {
    await fetch('/api/staff/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ station_kind: kind, station_label: label }),
    })
    localStorage.setItem('station', label)
    localStorage.setItem('door_label', label)
    router.push(DEST[kind] ?? '/dashboard')
  }

  return (
    <main className="min-h-screen bg-[#08070D] px-5 py-8 text-[#F3EDE4]" data-tenant="memories-nc">
      <Wordmark href="/" size="sm" />
      <p className="mt-8 text-[11px] uppercase tracking-[0.28em] text-[#8A8580]">{name || 'Staff'}</p>
      <h1 className="mt-2 font-display text-[40px] leading-tight">Claim your station</h1>
      <p className="mt-2 max-w-sm text-[14px] text-[#8A8580]">One person. One station. The house knows who is on it.</p>
      <div className="mt-8 grid gap-3">
        {stations.map(s => (
          <button
            key={s.kind + s.label}
            onClick={() => void claim(s.kind, s.label)}
            className="border border-[#2A242C] bg-[#100E14] px-5 py-5 text-left"
          >
            <p className="text-[11px] uppercase tracking-[0.22em] text-ev-crimson">{KIND[s.kind] ?? s.kind}</p>
            <p className="mt-1 font-display text-[28px] leading-none">{s.label}</p>
          </button>
        ))}
      </div>
    </main>
  )
}
