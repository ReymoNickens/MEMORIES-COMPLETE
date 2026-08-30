import { randomToken } from '@evolveit/shared/crypto'
import { refundCharge } from './paystack'
import { demoPaymentsAllowed } from './runtime'

type ServiceClient = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
}

/**
 * Give a customer their money back when a checkout cannot be fulfilled.
 *
 * The race this exists for: `checkout/initiate` checks stock, the customer
 * pays, and by the time the webhook lands another buyer has taken the last
 * pair. `complete_paid_checkout` decrements atomically and raises `sold_out`,
 * so the club never oversells — but until now it also kept the money.
 *
 * Idempotency is claimed in the database *before* the Paystack call, not
 * after. A webhook redelivery that arrives while the first refund is still in
 * flight loses the race for the marker and does nothing, so the customer
 * cannot be refunded twice.
 */
export async function refundCheckout(
  supabase: ServiceClient,
  checkout: { id: string; amount_pesewas: number; paystack_ref: string },
  reason: string,
): Promise<{ refunded: boolean; already?: boolean; error?: string }> {
  const refundRef = `rf_${randomToken(10)}`

  const { data: claimed, error: claimErr } = await supabase.rpc('begin_checkout_refund', {
    p_checkout_id: checkout.id,
    p_refund_ref: refundRef,
    p_amount_pesewas: checkout.amount_pesewas,
  })

  if (claimErr) return { refunded: false, error: claimErr.message }
  if (claimed !== true) return { refunded: false, already: true }

  // On the demo rail no money ever left a wallet, so there is nothing to call
  // Paystack about — but the checkout still has to reach a terminal state and
  // the ledger still has to show the round trip.
  if (demoPaymentsAllowed()) {
    await supabase.rpc('settle_checkout_refund', {
      p_checkout_id: checkout.id,
      p_ok: true,
      p_fee_kept_pesewas: 0,
      p_error: null,
    })
    return { refunded: true }
  }

  const result = await refundCharge({
    transactionRef: checkout.paystack_ref,
    reason: `Memories: ${reason}`,
  })

  if (!result.ok) {
    // Recorded as failed rather than retried in place. A refund that will not
    // go through is a customer who is out of pocket, and that needs a person
    // looking at it, not a loop.
    await supabase.rpc('settle_checkout_refund', {
      p_checkout_id: checkout.id,
      p_ok: false,
      p_fee_kept_pesewas: 0,
      p_error: result.message.slice(0, 500),
    })
    console.error(
      `refund FAILED for ${checkout.paystack_ref} (${refundRef}): ${result.message} — customer is owed ${checkout.amount_pesewas} pesewas`,
    )
    return { refunded: false, error: result.message }
  }

  // Paystack acknowledges the request here and confirms settlement later on
  // `refund.processed`. Booking it now keeps the clearing account matching
  // their statement; the later event is idempotent against this.
  await supabase.rpc('settle_checkout_refund', {
    p_checkout_id: checkout.id,
    p_ok: true,
    p_fee_kept_pesewas: 0,
    p_error: null,
  })

  return { refunded: true }
}
