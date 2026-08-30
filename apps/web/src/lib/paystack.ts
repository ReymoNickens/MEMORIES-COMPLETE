import { paystackLive } from './runtime'

/**
 * One place that talks to Paystack.
 *
 * Charge initiation was copy-pasted inline in two routes with slightly
 * different bodies and no timeout, and the refund call did not exist at all —
 * `triggerRefund` in the old Edge Function was a console.error and a TODO.
 */

const BASE = 'https://api.paystack.co'
const TIMEOUT_MS = 15_000

function secret(): string {
  const key = process.env['PAYSTACK_SECRET_KEY'] ?? ''
  if (!key) throw new Error('PAYSTACK_SECRET_KEY is not set')
  return key
}

async function call<T>(path: string, init: RequestInit): Promise<
  { ok: true; data: T } | { ok: false; status: number; message: string }
> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${secret()}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    return { ok: false, status: 0, message: err instanceof Error ? err.message : 'network error' }
  }

  const body = await res.json().catch(() => null) as { status?: boolean; message?: string; data?: T } | null
  if (!res.ok || body?.status === false) {
    return { ok: false, status: res.status, message: body?.message ?? `paystack ${res.status}` }
  }
  return { ok: true, data: body?.data as T }
}

export interface InitOptions {
  email: string
  amountPesewas: number
  reference: string
  callbackPath: string
  metadata: Record<string, unknown>
}

export async function initializeCharge(opts: InitOptions) {
  return call<{ authorization_url: string; reference: string }>('/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify({
      email: opts.email,
      amount: opts.amountPesewas,
      currency: 'GHS',
      reference: opts.reference,
      callback_url: `${process.env['NEXT_PUBLIC_APP_URL'] ?? ''}${opts.callbackPath}`,
      metadata: opts.metadata,
    }),
  })
}

/**
 * Refund a charge, in full or in part.
 *
 * Paystack keys a refund off the original transaction reference, and refunding
 * the same reference twice for the same amount returns an error rather than
 * moving money twice — but we do not rely on that. The caller records its own
 * idempotency marker before calling, so a webhook redelivery cannot start a
 * second refund even if Paystack would have allowed one.
 */
export async function refundCharge(opts: {
  transactionRef: string
  amountPesewas?: number
  reason?: string
}) {
  const body: Record<string, unknown> = {
    transaction: opts.transactionRef,
    merchant_note: (opts.reason ?? 'refund').slice(0, 200),
  }
  // Omitting amount refunds the full charge, which is what a sold-out race
  // needs; a partial refund is used for installment forfeiture.
  if (typeof opts.amountPesewas === 'number') body['amount'] = opts.amountPesewas

  return call<{ id: number; status: string; refunded_at: string | null }>('/refund', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

/** Read a charge back from Paystack. Used to reconcile, never to authorise. */
export async function verifyCharge(reference: string) {
  return call<{
    status: string
    amount: number
    currency: string
    fees: number | null
    channel: string
  }>(`/transaction/verify/${encodeURIComponent(reference)}`, { method: 'GET' })
}

/** Live keys move real money. Some paths refuse to run without one. */
export function isLive(): boolean {
  return paystackLive()
}
