'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Wordmark } from '@/components/Wordmark'
import { directDestinationForRoles } from '@/lib/station-roles'
import type { StaffRole } from '@evolveit/shared/types'

const DEST: Record<string, string> = {
  door: '/scanner',
  bar: '/bar',
  kitchen: '/kitchen',
  floor: '/waiter',
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
  const [stations, setStations] = useState<Array<{ kind: string; label: string }> | null>(null)
  const [name, setName] = useState('')
  const [roles, setRoles] = useState<StaffRole[]>([])

  useEffect(() => {
    void fetch('/api/staff/me').then(r => {
      if (r.status === 401) { router.push('/staff/login'); return null }
      return r.json() as Promise<{ session?: { full_name: string; roles: StaffRole[] }; stations?: Array<{ kind: string; label: string }> }>
    }).then(d => {
      if (!d) return
      const userRoles = d.session?.roles ?? []
      const offered = d.stations ?? []
      // A role with nothing to claim (hr, finance, dj, mc reaching this
      // screen directly, e.g. from a bookmark) has no reason to be here.
      if (offered.length === 0) { router.replace(directDestinationForRoles(userRoles)); return }
      setName(d.session?.full_name ?? '')
      setRoles(userRoles)
      setStations(offered)
    })
  }, [router])

  const [claimErr, setClaimErr] = useState('')

  async function claim(kind: string, label: string) {
    setClaimErr('')
    const res = await fetch('/api/staff/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ station_kind: kind, station_label: label }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => null) as { error?: string } | null
      setClaimErr(j?.error ?? 'Could not claim that station.')
      return
    }
    localStorage.setItem('station', label)
    localStorage.setItem('door_label', label)
    router.push(DEST[kind] ?? '/dashboard')
  }

  if (stations === null) {
    return (
      <main className="min-h-screen bg-[#08070D] px-5 py-8 text-[#F3EDE4]" data-tenant="memories-nc">
        <p className="mt-16 text-center text-[14px] text-[#8A8580]">Loading…</p>
      </main>
    )
  }

  const skipTo = directDestinationForRoles(roles)
  const canSkip = skipTo !== '/staff/home'

  return (
    <main className="min-h-screen bg-[#08070D] px-5 py-8 text-[#F3EDE4]" data-tenant="memories-nc">
      <Wordmark href="/" size="sm" />
      <p className="mt-8 text-[11px] uppercase tracking-[0.28em] text-[#8A8580]">{name || 'Staff'}</p>
      <h1 className="mt-2 font-display text-[40px] leading-tight">Claim your station</h1>
      <p className="mt-2 max-w-sm text-[14px] text-[#8A8580]">One person. One station. The house knows who is on it.</p>
      {claimErr && <p className="mt-4 text-[13px] text-ev-crimson">{claimErr}</p>}
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
      {canSkip && (
        <button
          onClick={() => router.push(skipTo)}
          className="mt-8 text-[11px] uppercase tracking-[0.2em] text-[#8A8580] underline underline-offset-4"
        >
          Not working a station tonight — go to your screen
        </button>
      )}
    </main>
  )
}
