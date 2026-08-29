import type { Metadata, Viewport } from 'next'
import { Instrument_Serif, Manrope, IBM_Plex_Mono } from 'next/font/google'
import '../styles/globals.css'

const display = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-display',
  display: 'swap',
})

const body = Manrope({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-body',
  display: 'swap',
})

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Memories Night Club',
  description: 'Cape Coast. Friday and Saturday. Some nights are forever.',
  manifest: '/manifest.json',
}

export const viewport: Viewport = {
  themeColor: '#08070D',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-tenant="memories-nc" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body className="font-body bg-[#08070D] text-[#F3EDE4] antialiased">{children}</body>
    </html>
  )
}
