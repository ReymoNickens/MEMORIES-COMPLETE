import type { ReactNode } from 'react'
import { Wordmark } from './Wordmark'

export function GuestChrome({
  children,
  kicker,
}: {
  children: ReactNode
  kicker?: string
}) {
  return (
    <div className="relative min-h-screen text-[#F3EDE4]" data-tenant="memories-nc">
      <header className="relative z-10 flex items-end justify-between px-5 pt-6 pb-4">
        <div>
          <Wordmark size="sm" />
          {kicker && (
            <p className="mt-2 text-[10px] uppercase tracking-[0.28em] text-[#8A8580]">{kicker}</p>
          )}
        </div>
        <p className="text-right text-[10px] uppercase tracking-[0.22em] text-[#8A8580]">
          Fri &amp; Sat
          <br />
          Doors 10PM
        </p>
      </header>
      {children}
    </div>
  )
}
