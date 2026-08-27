import Link from 'next/link'

export default function HomePage() {
  return (
    <main className="min-h-screen bg-ev-bg text-ev-primary" data-tenant="memories-nc">
      <div className="max-w-xl mx-auto px-6 py-16 text-center">
        <p className="text-label tracking-widest text-ev-secondary mb-3">SAMRIT HOTEL · CAPE COAST</p>
        <h1 className="text-display-xl font-display text-white mb-3">MEMORIES</h1>
        <p className="text-body-md text-ev-secondary mb-10">Friday &amp; Saturday · Doors 10PM</p>
        <div className="flex flex-col gap-3">
          <Link href="/events" className="h-14 rounded-lg bg-ev-crimson text-white font-semibold flex items-center justify-center">
            Get tickets
          </Link>
          <Link href="/staff/login" className="h-12 rounded-lg border border-ev-borderDark text-ev-accent flex items-center justify-center">
            Staff station
          </Link>
        </div>
      </div>
    </main>
  )
}
