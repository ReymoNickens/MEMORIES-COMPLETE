'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Wordmark } from '@/components/Wordmark'

interface Photo {
  id: string
  url: string
  caption: string | null
}

export default function GalleryAdminPage() {
  const [photos, setPhotos] = useState<Photo[] | null>(null)
  const [err, setErr] = useState('')
  const [uploading, setUploading] = useState(false)

  async function load() {
    const res = await fetch('/api/admin/gallery', { cache: 'no-store' })
    if (res.status === 401 || res.status === 403) { window.location.href = '/staff/login'; return }
    const j = await res.json() as { photos?: Photo[]; error?: string }
    if (j.error) { setErr(j.error); return }
    setPhotos(j.photos ?? [])
  }

  useEffect(() => { void load() }, [])

  async function upload(file: File) {
    setUploading(true)
    const body = new FormData()
    body.append('file', file)
    const res = await fetch('/api/admin/gallery', { method: 'POST', body })
    const j = await res.json() as { error?: string }
    setUploading(false)
    if (j.error) { setErr(j.error); return }
    setErr('')
    await load()
  }

  async function remove(id: string) {
    await fetch(`/api/admin/gallery?id=${id}`, { method: 'DELETE' })
    await load()
  }

  return (
    <div className="min-h-screen bg-ev-bg text-ev-primary">
      <header className="flex items-center justify-between border-b border-ev-border px-6 py-5">
        <Wordmark href="/" size="sm" />
        <Link href="/admin" className="text-[11px] uppercase tracking-[0.18em] text-ev-muted hover:text-ev-primary">← Events</Link>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8">
        <h1 className="font-display text-h1">Gallery</h1>
        <p className="mt-1 text-[13px] text-ev-muted">Photos shown on the public site's gallery/hero content.</p>
        {err && <p className="mt-4 border-l-2 border-ev-crimson pl-4 text-[13px] text-ev-crimson">{err}</p>}

        <input
          type="file" accept="image/jpeg,image/png,image/webp"
          disabled={uploading}
          className="mt-6 text-[13px]"
          onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f) }}
        />
        {uploading && <p className="mt-1 text-[12px] text-ev-muted">Uploading…</p>}

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos?.map(p => (
            <div key={p.id} className="relative border border-ev-border">
              <img src={p.url} alt={p.caption ?? ''} className="h-32 w-full object-cover" />
              <button
                onClick={() => void remove(p.id)}
                className="absolute right-1 top-1 bg-black/70 px-2 py-1 text-[11px] uppercase tracking-[0.1em] text-white"
              >
                Remove
              </button>
            </div>
          ))}
          {photos?.length === 0 && <p className="text-[13px] text-ev-muted">No photos yet.</p>}
        </div>
      </main>
    </div>
  )
}
