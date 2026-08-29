import Link from 'next/link'
import { Wordmark } from '@/components/Wordmark'

export default function HomePage() {
  return (
    <main className="relative min-h-screen overflow-hidden mnc-grain" data-tenant="memories-nc">
      <img
        src="/room.jpg"
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="absolute inset-0 mnc-veil" />
      <div className="relative z-10 flex min-h-screen flex-col justify-between px-6 pb-8 pt-8">
        <p className="text-[11px] uppercase tracking-[0.32em] text-[#C4B8A8]">
          SamRit Hotel · Cape Coast
        </p>

        <div className="max-w-lg">
          <Wordmark href={null} size="hero" />
          <p className="mt-6 font-display text-[28px] leading-tight text-[#F3EDE4] sm:text-[34px]">
            Some nights are forever.
          </p>
          <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-[#C4B8A8]">
            Friday and Saturday. Doors 10PM. No velvet rope — the room is the room.
            Do not wait for the gate price.
          </p>
        </div>

        <div className="max-w-sm">
          <Link
            href="/events"
            className="flex h-14 items-center justify-center bg-ev-crimson text-[13px] font-semibold uppercase tracking-[0.22em] text-white"
          >
            Secure your night
          </Link>
          <p className="mt-4 text-[11px] uppercase tracking-[0.2em] text-[#8A8580]">
            Afrobeats · Amapiano · Afro house
          </p>
        </div>
      </div>
    </main>
  )
}
