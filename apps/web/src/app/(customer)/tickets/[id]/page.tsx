'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import QRCode from 'qrcode.react'
import { generateQrPayload } from '@evolveit/shared/totp'
import { Wordmark } from '@/components/Wordmark'

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
  const [seconds, setSeconds] = useState(30)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const access = search.get('access') || sessionStorage.getItem(`ticket-access-${id}`)
    if (!access) return
    void fetch(`/api/tickets/${id}?access=${access}`)
      .then(r => r.json())
      .then((data: TicketData & { error?: string }) => {
        if (data.error) return
        setTicket(data)
        const rotate = () => {
          setQrValue(generateQrPayload(data.id, data.totp_secret))
          setSeconds(30)
        }
        rotate()
        intervalRef.current = setInterval(rotate, 30_000)
      })
    const tick = setInterval(() => setSeconds(s => (s <= 1 ? 30 : s - 1)), 1000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      clearInterval(tick)
    }
  }, [id, search])

  if (!ticket) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6 text-center text-[#8A8580]">
        This pass needs its private link.
      </main>
    )
  }

  const vip = ticket.ticket_type_name.toLowerCase().includes('vip')
  const circ = 2 * Math.PI * 45
  const offset = circ * (1 - seconds / 30)

  return (
    <main className="relative min-h-screen overflow-hidden mnc-grain" data-tenant="memories-nc">
      <img src="/room.jpg" alt="" className="absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-0 bg-[#08070D]/82" />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-md flex-col px-5 py-7">
        <div className="flex items-end justify-between">
          <Wordmark href="/" size="sm" />
          <p className="text-[10px] uppercase tracking-[0.22em] text-[#C4B8A8]">Door pass</p>
        </div>

        <article className="mt-8 overflow-hidden bg-[#100E14] shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
          <div className={`h-1.5 ${vip ? 'bg-[#C4B8A8]' : 'bg-ev-crimson'}`} />
          <div className="px-5 pt-5">
            <p className="text-[10px] uppercase tracking-[0.28em] text-[#8A8580]">
              {new Date(ticket.event_date).toLocaleString('en-GH', {
                weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
              })}
            </p>
            <h1 className="mt-2 font-display text-[32px] leading-tight">{ticket.event_name}</h1>
          </div>

          <div className="relative mx-5 my-6 flex items-center justify-center">
            <svg className="absolute h-[228px] w-[228px] -rotate-90" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="45" fill="none" stroke="#2A242C" strokeWidth="2" />
              <circle
                cx="50" cy="50" r="45" fill="none" stroke="#B8122A" strokeWidth="2"
                strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="butt"
              />
            </svg>
            <div className="bg-[#E8DCC8] p-3">
              {qrValue && (
                <QRCode value={qrValue} size={168} bgColor="#E8DCC8" fgColor="#14090B" level="M" />
              )}
            </div>
          </div>

          <div className="flex items-end justify-between border-t border-dashed border-[#2A242C] px-5 py-4">
            <div>
              <p className="font-display text-[22px] leading-none">{ticket.buyer_name}</p>
              <p className="mt-1 text-[11px] uppercase tracking-[0.2em] text-[#C4B8A8]">
                {ticket.ticket_type_name}
              </p>
            </div>
            <p className="font-mono text-[12px] tracking-wider text-[#8A8580]">{ticket.serial}</p>
          </div>
        </article>

        <p className="mt-6 text-center text-[12px] leading-relaxed text-[#8A8580]">
          Live code. {seconds}s until the next cycle.
          <br />
          A screenshot of an old cycle will not open the door.
        </p>
      </div>
    </main>
  )
}
