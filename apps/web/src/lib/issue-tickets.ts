import { encodeTotpSecret, randomToken, sha256Hex } from '@evolveit/shared/crypto'
import { splitPesewas } from '@evolveit/shared/money'
import * as OTPAuth from 'otpauth'
import { enqueue, ticketDeepLink } from './outbox'

type ServiceClient = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
  from: (table: string) => {
    insert: (rows: unknown) => Promise<{ error: { message: string; code?: string } | null }>
    select: (cols: string) => {
      eq: (col: string, val: unknown) => {
        maybeSingle: () => Promise<{ data: Record<string, unknown> | null }>
      }
    }
  }
}

function paymentMethod(raw?: string): 'momo' | 'card' | 'ussd' {
  if (raw === 'card' || raw === 'ussd') return raw
  return 'momo'
}

export async function issueTicketsFromCheckout(
  supabase: ServiceClient,
  checkout: {
    id: string
    tenant_id?: string
    event_id?: string
    quantity: number
    amount_pesewas: number
    paystack_ref: string
    buyer_name?: string
    buyer_phone?: string
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
  const ticketIds = result.ticket_ids ?? []

  // Hand the buyer their ticket. This is the only moment the raw access token
  // exists — the database stores only its hash — so if the link is not put in
  // front of the customer here, it cannot be reconstructed later.
  if (!result.already && checkout.tenant_id && checkout.buyer_phone) {
    await queueTicketDelivery(supabase, checkout, ticketIds, accessTokens)
  }

  return {
    ticket_ids: ticketIds,
    access_tokens: result.already ? [] : accessTokens,
    already: !!result.already,
  }
}

async function queueTicketDelivery(
  supabase: ServiceClient,
  checkout: {
    id: string
    tenant_id?: string
    event_id?: string
    paystack_ref: string
    buyer_name?: string
    buyer_phone?: string
  },
  ticketIds: string[],
  accessTokens: string[],
): Promise<void> {
  let eventName = 'Memories Night Club'
  let eventDate = ''
  if (checkout.event_id) {
    const { data: event } = await supabase
      .from('events').select('name, starts_at').eq('id', checkout.event_id).maybeSingle()
    if (event) {
      eventName = String(event['name'] ?? eventName)
      eventDate = new Date(String(event['starts_at'])).toLocaleString('en-GH', {
        weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      })
    }
  }

  // One message per ticket, so a buyer who bought four can forward one link
  // each rather than walking four people in from one phone.
  await enqueue(supabase, ticketIds.map((id, i) => ({
    tenant_id: checkout.tenant_id!,
    kind: 'ticket_delivery' as const,
    to_phone: checkout.buyer_phone!,
    payload: {
      buyer_name: checkout.buyer_name ?? 'Guest',
      event_name: eventName,
      event_date: eventDate,
      serial: '',
      deep_link: ticketDeepLink(id, accessTokens[i] ?? ''),
    },
    dedupe_key: `ticket:${id}`,
  })))
}
