'use client'
import { useEffect, useState, useRef } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
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
  const search = useSearchParams()
  const [ticket, setTicket] = useState<TicketData | null>(null)
  const [qrValue, setQrValue] = useState('')
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const access = search.get('access') || sessionStorage.getItem(`ticket-access-${id}`)
    if (!access) return
    void fetch(`/api/tickets/${id}?access=${access}`)
      .then(r => r.json())
      .then((data: TicketData & { error?: string }) => {
        if (data.error) return
        setTicket(data)
        sessionStorage.setItem(`ticket-secret-${id}`, JSON.stringify(data))
        const rotate = () => setQrValue(generateQrPayload(data.id, data.totp_secret))
        rotate()
        intervalRef.current = setInterval(rotate, 30_000)
      })
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [id, search])

  if (!ticket) {
    return <div className="min-h-screen bg-ev-bg flex items-center justify-center text-ev-secondary">Need ticket access link</div>
  }

  return (
    <div className="min-h-screen bg-ev-bg flex flex-col items-center pt-8 px-4" data-tenant="memories-nc">
      <h2 className="text-h2 text-white font-display tracking-widest uppercase mb-6">Memories Night Club</h2>
      <h1 className="font-display text-display-lg text-white text-center mb-2">{ticket.event_name}</h1>
      <p className="text-body-md text-ev-secondary mb-8">{new Date(ticket.event_date).toLocaleString('en-GH')}</p>
      {qrValue && (
        <div className="bg-white p-3 rounded-lg mb-4">
          <QRCode value={qrValue} size={260} bgColor="#FFFFFF" fgColor="#08070D" level="M" />
        </div>
      )}
      <p className="font-mono text-ev-muted mb-2">{ticket.serial}</p>
      <p className="text-white">{ticket.buyer_name} · {ticket.ticket_type_name}</p>
      <p className="text-micro text-ev-muted mt-4">QR rotates every 30s · EV1.uuid.code</p>
    </div>
  )
}
