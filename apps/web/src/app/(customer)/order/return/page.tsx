'use client'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'

export default function OrderReturnPage() {
  const params = useSearchParams()
  const ref = params.get('ref')
  const [msg, setMsg] = useState('Confirming your order…')
  const [tableLabel, setTableLabel] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!ref) { setMsg('No payment reference found.'); setFailed(true); return }
    const t = setInterval(async () => {
      const res = await fetch(`/api/orders/return?ref=${ref}`)
      const data = await res.json() as { confirmed?: boolean; table_label?: string; status?: string }
      if (data.confirmed) {
        clearInterval(t)
        setTableLabel(data.table_label ?? null)
        setMsg('Order confirmed! Your drinks and food are on their way.')
      } else if (data.status === 'cancelled' || data.status === 'failed') {
        clearInterval(t)
        setFailed(true)
        setMsg('Payment was not completed. Please try again at the bar.')
      }
    }, 2000)
    // Stop polling after 3 minutes
    const timeout = setTimeout(() => {
      clearInterval(t)
      if (!tableLabel) { setFailed(true); setMsg('Could not confirm order. Please check with staff.') }
    }, 3 * 60 * 1000)
    return () => { clearInterval(t); clearTimeout(timeout) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref])

  return (
    <main className="min-h-screen bg-ev-bg text-white flex flex-col items-center justify-center px-6" data-tenant="memories-nc">
      <div className="w-16 h-16 rounded-full flex items-center justify-center mb-6 text-3xl" style={{ background: failed ? '#B8122A' : '#0B1D3A' }}>
        {failed ? '✗' : tableLabel ? '✓' : '…'}
      </div>
      <h1 className="font-display text-h1 mb-3">{tableLabel ? `Table ${tableLabel}` : 'Order'}</h1>
      <p className="text-ev-secondary text-body-md text-center max-w-xs">{msg}</p>
      {!failed && !tableLabel && (
        <p className="text-micro text-ev-muted mt-6">This page will update automatically.</p>
      )}
    </main>
  )
}
