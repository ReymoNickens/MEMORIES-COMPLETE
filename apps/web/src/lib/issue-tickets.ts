import { encodeTotpSecret, randomToken, sha256Hex } from '@evolveit/shared/crypto'
import { splitPesewas } from '@evolveit/shared/money'
import * as OTPAuth from 'otpauth'

type ServiceClient = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
}

function paymentMethod(raw?: string): 'momo' | 'card' | 'ussd' {
  if (raw === 'card' || raw === 'ussd') return raw
  return 'momo'
}

export async function issueTicketsFromCheckout(
  supabase: ServiceClient,
  checkout: {
    id: string
    quantity: number
    amount_pesewas: number
    paystack_ref: string
  },
  opts?: { fee_pesewas?: number; method?: string },
): Promise<{ ticket_ids: string[]; access_tokens: string[]; already: boolean }> {
  const amounts = splitPesewas(checkout.amount_pesewas, checkout.quantity)
  const fees = splitPesewas(opts?.fee_pesewas ?? 0, checkout.quantity)
  const method = paymentMethod(opts?.method)
  const accessTokens = Array.from({ length: checkout.quantity }, () => randomToken(18))

  const bundle = amounts.map((amount_pesewas, i) => ({
    totp_enc: encodeTotpSecret(new OTPAuth.Secret({ size: 20 }).base32),
    access_hash: sha256Hex(accessTokens[i]!),
    amount_pesewas,
    fee_pesewas: fees[i] ?? 0,
    method,
    paystack_ref: `${checkout.paystack_ref}-${i + 1}`,
  }))

  const { data, error } = await supabase.rpc('complete_paid_checkout', {
    p_checkout_id: checkout.id,
    p_tickets: bundle,
  })

  if (error) {
    const msg = error.message ?? ''
    if (msg.includes('sold_out')) throw new Error('sold_out')
    throw new Error(msg || 'issue_failed')
  }

  const result = data as { ok?: boolean; already?: boolean; ticket_ids?: string[] }
  return {
    ticket_ids: result.ticket_ids ?? [],
    access_tokens: result.already ? [] : accessTokens,
    already: !!result.already,
  }
}
