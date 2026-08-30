import type { ReactNode } from 'react'
import { Wordmark } from './Wordmark'

export function FloorShell({
  station,
  clock,
  children,
}: {
  station: string
  clock?: string
  children: ReactNode
}) {
  return (
    <div className="min-h-screen bg-[#08070D] text-[#F3EDE4]" data-tenant="memories-nc">
      <header className="flex items-end justify-between border-b border-[#2A242C] px-5 py-4">
        <div>
          <Wordmark href="/staff/claim" size="sm" />
          <p className="mt-2 text-[11px] uppercase tracking-[0.28em] text-[#8A8580]">{station}</p>
        </div>
        <p className="font-mono text-[13px] text-[#C4B8A8]">{clock}</p>
      </header>
      {children}
    </div>
  )
}

/**
 * How long a ticket has been sitting. Three minutes is fine, seven is a
 * complaint, past that a table is waiting and someone should be told — so the
 * caller gets a `late` flag and can escalate the whole card, not just tint a
 * number nobody looks at across a dark room.
 */
export function ageTone(iso: string): { label: string; className: string; late: boolean } {
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  const label = secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m`
  if (secs < 180) return { label, className: 'text-[#7DCF8A]', late: false }
  if (secs < 420) return { label, className: 'text-[#E0A24A]', late: false }
  return { label, className: 'text-ev-crimson', late: true }
}
