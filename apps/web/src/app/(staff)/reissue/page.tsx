'use client'
import { useState } from 'react'

export default function ReissuePage() {
  const [ticketId, setTicketId] = useState('')
  const [reason, setReason] = useState('reissue_lost')
  const [result, setResult] = useState('')

  async function run() {
    const res = await fetch('/api/tickets/reissue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket_id: ticketId, reason }),
    })
    const data = await res.json()
    if (data.access_token) {
      setResult(`/tickets/${data.ticket_id}?access=${data.access_token}`)
    } else {
      setResult(data.error ?? 'failed')
    }
  }

  return (
    <main className="min-h-screen bg-ev-page p-6 max-w-lg">
      <h1 className="font-display text-h1 mb-4">Reissue ticket</h1>
      <p className="text-body-md text-ev-muted mb-4">Rotates TOTP secret. Max 2 reissues. Does not reprint used/voided tickets.</p>
      <input className="w-full h-12 border rounded px-3 mb-3" placeholder="Ticket UUID" value={ticketId} onChange={e => setTicketId(e.target.value)} />
      <select className="w-full h-12 border rounded px-3 mb-3" value={reason} onChange={e => setReason(e.target.value)}>
        <option value="reissue_lost">Lost</option>
        <option value="reissue_stolen">Stolen</option>
        <option value="admin">Admin</option>
      </select>
      <button onClick={() => void run()} className="h-12 px-6 bg-ev-crimson text-white rounded">Reissue</button>
      {result && <p className="mt-4 break-all text-micro">{result}</p>}
    </main>
  )
}
