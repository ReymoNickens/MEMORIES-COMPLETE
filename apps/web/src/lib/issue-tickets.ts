import { encryptSecret, randomToken, sha256Hex } from '@evolveit/shared/crypto'
import { sendTicketDelivery } from '@evolveit/shared/notify'
import * as OTPAuth from 'otpauth'
import { randomBytes } from 'node:crypto'

function totpKey(): string {
  const k = process.env['TOTP_ENCRYPTION_KEY']
  if (!k || k.length !== 64) throw new Error('TOTP_ENCRYPTION_KEY must be a 64-char hex string')
  return k
}

type ServiceClient = {
  from: (table: string) => any
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
}

function generateSerial(): string {
  const year = new Date().getFullYear()
  const suffix = randomBytes(4).toString('hex').toUpperCase()
  return `MNC-${year}-${suffix}`
}

export async function issueTicketsFromCheckout(
  supabase: ServiceClient,
  checkout: {
    id: string
    tenant_id: string
    ticket_type_id: string
    event_id: string
    quantity: number
    buyer_name: string
    buyer_phone: string
    buyer_email: string
    amount_pesewas: number
    paystack_ref: string
  },
  opts?: { fee_pesewas?: number; method?: string }
): Promise<{ ticket_ids: string[]; access_tokens: string[] }> {
  // Generate all per-ticket material in Node.js (TOTP library not available in plpgsql)
  const totpSecretsEnc: string[] = []
  const serials: string[] = []
  const rawTokens: string[] = []
  const tokenHashes: string[] = []

  for (let i = 0; i < checkout.quantity; i++) {
    const secret = new OTPAuth.Secret({ size: 20 }).base32
    totpSecretsEnc.push(encryptSecret(secret, totpKey()))
    serials.push(generateSerial())
    const raw = randomToken(18)
    rawTokens.push(raw)
    tokenHashes.push(sha256Hex(raw))
  }

  const method = opts?.method === 'card' || opts?.method === 'ussd' ? opts.method : 'momo'

  // Single atomic RPC: stock decrement + all inserts in one transaction
  const { data, error } = await supabase.rpc('issue_tickets_atomic', {
    p_checkout_id:    checkout.id,
    p_tenant_id:      checkout.tenant_id,
    p_event_id:       checkout.event_id,
    p_ticket_type_id: checkout.ticket_type_id,
    p_quantity:       checkout.quantity,
    p_buyer_name:     checkout.buyer_name,
    p_buyer_phone:    checkout.buyer_phone,
    p_buyer_email:    checkout.buyer_email,
    p_paystack_ref:   checkout.paystack_ref,
    p_amount_pesewas: checkout.amount_pesewas,
    p_fee_pesewas:    opts?.fee_pesewas ?? 0,
    p_method:         method,
    p_totp_secrets:   totpSecretsEnc,
    p_serials:        serials,
    p_token_hashes:   tokenHashes,
  })

  if (error) {
    const msg = error.message ?? ''
    if (msg.includes('sold_out')) {
      await supabase.from('pending_checkouts').update({ status: 'failed' }).eq('id', checkout.id)
      throw new Error('sold_out')
    }
    throw new Error(msg || 'issue_tickets_failed')
  }

  const ticketIds = ((data as unknown) as Array<{ ticket_id: string }> ?? []).map(r => r.ticket_id)

  // Store encrypted tokens in pending_checkouts for the status-polling endpoint.
  // Encrypted at rest so a DB breach alone does not reveal usable access tokens.
  const encryptedTokens = rawTokens.map(t => encryptSecret(t, totpKey()))
  void supabase.from('pending_checkouts').update({ access_tokens: encryptedTokens }).eq('id', checkout.id)

  // Fire-and-forget notifications — failure must not break ticket issuance
  void notifyBuyers(supabase, checkout, ticketIds, rawTokens)

  return { ticket_ids: ticketIds, access_tokens: rawTokens }
}

async function notifyBuyers(
  supabase: ServiceClient,
  checkout: { buyer_phone: string; buyer_name: string; event_id: string; paystack_ref: string },
  ticketIds: string[],
  accessTokens: string[],
): Promise<void> {
  try {
    const { data: event } = await supabase
      .from('events')
      .select('name, starts_at')
      .eq('id', checkout.event_id)
      .single()
    const { data: serials } = await supabase
      .from('tickets')
      .select('id, serial')
      .in('id', ticketIds)

    const appUrl = process.env['APP_URL'] ?? process.env['NEXT_PUBLIC_APP_URL'] ?? ''
    const serialMap = Object.fromEntries((serials ?? []).map((s: { id: string; serial: string }) => [s.id, s.serial]))

    for (let i = 0; i < ticketIds.length; i++) {
      const id = ticketIds[i]
      const token = accessTokens[i]
      if (!id || !token) continue
      await sendTicketDelivery({
        buyerPhone: checkout.buyer_phone,
        buyerName: checkout.buyer_name,
        eventName: (event as { name: string } | null)?.name ?? 'Your event',
        eventDate: (event as { starts_at: string } | null)?.starts_at ?? '',
        ticketSerial: serialMap[id] ?? id,
        deepLink: `${appUrl}/tickets/${id}?access=${token}`,
        venueName: 'Memories Night Club',
      })
    }
  } catch (err) {
    console.error('Ticket notification failed:', err instanceof Error ? err.message : 'unknown')
  }
}
