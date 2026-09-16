'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Wordmark } from '@/components/Wordmark'
import type { StaffRole } from '@evolveit/shared/types'

const ROLE_LABEL: Partial<Record<StaffRole, string>> = {
  hr: 'HR',
  finance: 'Finance',
  dj: 'DJ',
  mc: 'MC',
}

// Landing page for a role that's on the roster (migration 013/014 added hr,
// finance, dj and mc to user_roles) but doesn't have a dedicated screen
// built yet — payroll, payables, the announcements/attendance/chat tables
// exist in the database with no frontend in front of them. Rather than
// dropping these logins on a blank station-claim screen with nothing to
// click, or worse, defaulting them onto the owner dashboard they have no
// business seeing, this is an honest holding screen.
export default function StaffHomePage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [roles, setRoles] = useState<StaffRole[]>([])

  useEffect(() => {
    void fetch('/api/staff/me').then(r => {
      if (r.status === 401) { router.push('/staff/login'); return null }
      return r.json() as Promise<{ session?: { full_name: string; roles: StaffRole[] } }>
    }).then(d => {
      if (!d) return
      setName(d.session?.full_name ?? '')
      setRoles(d.session?.roles ?? [])
    })
  }, [router])

  const labels = roles.map(r => ROLE_LABEL[r] ?? r).join(' · ')

  return (
    <main className="min-h-screen bg-[#08070D] px-5 py-8 text-[#F3EDE4]" data-tenant="memories-nc">
      <Wordmark href="/" size="sm" />
      <p className="mt-8 text-[11px] uppercase tracking-[0.28em] text-[#8A8580]">{name || 'Staff'}</p>
      <h1 className="mt-2 font-display text-[32px] leading-tight">You're signed in{labels ? ` · ${labels}` : ''}</h1>
      <p className="mt-4 max-w-sm text-[14px] leading-relaxed text-[#8A8580]">
        There's no dedicated screen for your role yet — ask a manager if you
        need something done tonight, or check the door/bar/floor boards for
        what's happening.
      </p>
    </main>
  )
}
