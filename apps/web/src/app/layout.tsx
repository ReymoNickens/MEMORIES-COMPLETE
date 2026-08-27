import type { Metadata } from 'next'
import '../styles/globals.css'

export const metadata: Metadata = {
  title: 'Memories Night Club',
  description: 'EvolveIT Digital Operations Platform',
  manifest: '/manifest.json',
  themeColor: '#B8122A',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-tenant="memories-nc">
      <body className="font-body bg-ev-page text-ev-dark">{children}</body>
    </html>
  )
}
