'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

const DEST: Record<string, string> = {
  door: '/scanner',
  bar: '/bar',
  kitchen: '/kitchen',
  floor: '/floor',
  cashier: '/dashboard',
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
    <main className="min-h-screen bg-ev-page p-6">
      <h1 className="font-display text-h1 mb-1">Claim a station</h1>
      <p className="text-ev-muted mb-6">{name}</p>
      <div className="grid gap-3 max-w-md">
        {stations.map(s => (
          <button key={s.kind + s.label} onClick={() => void claim(s.kind, s.label)} className="h-14 bg-white border rounded-xl text-left px-4">
            <span className="text-label text-ev-muted">{s.kind}</span>
            <span className="block font-semibold">{s.label}</span>
          </button>
        ))}
      </div>
    </main>
  )
}
