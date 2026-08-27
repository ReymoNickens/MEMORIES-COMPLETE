'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import QRCode from 'qrcode.react'
import { generateQrPayload } from '@evolveit/shared/totp'

interface TicketData {
  id: string
  serial: string
  buyer_name: string
  totp_secret: string
  event_name: string
  event_date: string
  ticket_type_name: string
  status: string
}

export default function TicketPage() {
  const { id } = useParams<{ id: string }>()
  const [ticket, setTicket] = useState<TicketData | null>(null)
  const [qrValue, setQrValue] = useState('')
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    // In production: fetch ticket + OTP-secret (via authenticated session)
    // Cache TOTP secret in sessionStorage for offline use
    const cached = sessionStorage.getItem(`ticket-secret-${id}`)
    if (cached) {
      const data = JSON.parse(cached) as TicketData
      setTicket(data)
      rotateQr(data)
      intervalRef.current = setInterval(() => rotateQr(data), 30_000)
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [id])

  function rotateQr(data: TicketData) {
    const payload = generateQrPayload(data.id, data.totp_secret)
    setQrValue(payload)
  }

  if (!ticket) {
    return (
      <div className="min-h-screen bg-ev-bg flex items-center justify-center">
        <p className="text-body-md text-ev-secondary">Loading ticket...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-ev-bg flex flex-col items-center pt-8 px-4" data-tenant="memories-nc">
      {/* Logo */}
      <div className="mb-6">
        <h2 className="text-h2 text-white font-display tracking-widest uppercase text-center">
          Memories Night Club
        </h2>
      </div>

      {/* Event */}
      <h1 className="font-display text-display-lg text-white text-center mb-2">
        {ticket.event_name}
      </h1>
      <p className="font-body text-body-md text-ev-secondary mb-8">{ticket.event_date}</p>

      {/* QR Code */}
      {qrValue && (
        <div className="bg-ev-bg p-4 rounded-lg mb-4">
          <QRCode
            value={qrValue}
            size={280}
            bgColor="#0A0B0C"
            fgColor="#FFFFFF"
            level="M"
            includeMargin={false}
          />
        </div>
      )}

      {/* Serial */}
      <p className="font-mono text-data text-ev-muted mb-4 tracking-wider">
        {ticket.serial}
      </p>

      {/* Holder info */}
      <div className="text-center mb-8">
        <p className="font-body text-body-md text-ev-primary">{ticket.buyer_name}</p>
        <p className="font-body text-body-md text-ev-primary">{ticket.ticket_type_name}</p>
      </div>

      {/* Add to Wallet — Phase 2 */}
      <button
        disabled
        className="w-full max-w-xs h-12 border border-ev-accent text-ev-accent text-h3 rounded-lg opacity-40 cursor-not-allowed"
      >
        Add to Wallet
      </button>

      <p className="text-micro text-ev-muted mt-4">QR rotates every 30 seconds</p>
    </div>
  )
}
