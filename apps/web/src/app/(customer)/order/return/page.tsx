'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { formatAmount } from '@evolveit/shared/money'

interface OrderStatus {
  confirmed: boolean
  order_id?: string
  amount_pesewas?: number
  table_label?: string | null
  status?: string
}

/**
 * Where a guest lands after paying an F&B order by MoMo.
 *
 * Before this page existed, orders/initiate sent every MoMo payer — ticket
 * buyers and bar/kitchen customers alike — to /checkout/return, which polls
 * /api/tickets/status against pending_checkouts. An F&B order's reference
 * lives on the orders table, not pending_checkouts, so that lookup always
 * came back empty and a guest who had genuinely paid sat on "Waiting for
 * MoMo. Do not close this page." forever — even though the webhook had
 * already marked the order paid and sent it to the bar.
 */
function OrderReturnInner() {
  const params = useSearchParams()
  const ref = params.get('ref')
  const [status, setStatus] = useState<OrderStatus | null>(null)
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    if (!ref) return
    let cancelled = false

    const poll = setInterval(() => {
      void fetch(`/api/orders/status?ref=${encodeURIComponent(ref)}`)
        .then(r => r.json())
        .then((d: OrderStatus) => {
          if (cancelled) return
          setStatus(d)
          if (d.confirmed) clearInterval(poll)
        })
    }, 2000)

    // Orders have no 'failed' status the webhook ever sets — an abandoned or
    // declined charge just leaves the order sitting pending_payment forever.
    // Stop polling after a few minutes and point the guest at a human rather
    // than spinning indefinitely.
    const timeout = setTimeout(() => {
      cancelled = true
      clearInterval(poll)
      setTimedOut(true)
    }, 3 * 60 * 1000)

    return () => { cancelled = true; clearInterval(poll); clearTimeout(timeout) }
  }, [ref])

  const failed = status?.status === 'voided'
  const confirmed = !!status?.confirmed
  const token = status?.order_id ? status.order_id.slice(-4).toUpperCase() : null

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#08070D] px-6 text-center text-[#F3EDE4]">
      {!ref ? (
        <p className="text-[15px] text-ev-crimson">That link is missing its reference.</p>
      ) : confirmed ? (
        <>
          <p className="text-[11px] uppercase tracking-[0.28em] text-[#8A8580]">Order in</p>
          <p className="mt-4 font-display text-[96px] leading-none text-ev-crimson">{token}</p>
          {status?.table_label && (
            <p className="mt-2 text-[13px] uppercase tracking-[0.18em] text-[#8A8580]">{status.table_label}</p>
          )}
          {typeof status?.amount_pesewas === 'number' && (
            <p className="mt-4 font-mono text-[20px]">{formatAmount(status.amount_pesewas)}</p>
          )}
          <p className="mt-6 max-w-xs text-[15px] leading-relaxed text-[#C4B8A8]">
            That is your number. The bar calls it when your round is up.
          </p>
        </>
      ) : failed || timedOut ? (
        <>
          <p className="font-display text-[36px] leading-tight">
            {failed ? 'That payment did not go through.' : 'Still waiting.'}
          </p>
          <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-[#C4B8A8]">
            {failed
              ? 'Nothing has been charged. Show this screen to your server and order again.'
              : 'If money left your wallet, show this screen to a member of staff — do not pay twice.'}
          </p>
        </>
      ) : (
        <>
          <p className="font-display text-[28px]">Confirming your order…</p>
          <p className="mt-3 text-[13px] text-[#8A8580]">Do not close this page.</p>
        </>
      )}
    </div>
  )
}

export default function OrderReturnPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-[#08070D]">
        <p className="text-[11px] uppercase tracking-[0.24em] text-[#8A8580]">Order</p>
      </div>
    }>
      <OrderReturnInner />
    </Suspense>
  )
}
