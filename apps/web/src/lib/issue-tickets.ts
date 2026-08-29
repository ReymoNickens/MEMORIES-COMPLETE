import { encryptSecret, randomToken, sha256Hex } from '@evolveit/shared/crypto'

function totpKey(): string {
  const k = process.env['TOTP_ENCRYPTION_KEY']
  if (!k || k.length !== 64) throw new Error('TOTP_ENCRYPTION_KEY must be a 64-char hex string')
  return k
}
import * as OTPAuth from 'otpauth'

type ServiceClient = {
  from: (table: string) => any
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
}

function nextSerial(n: number): string {
  const year = new Date().getFullYear()
  return `MNC-${year}-${String(n).padStart(5, '0')}`
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
  const { data: stock, error: stockErr } = await supabase.rpc('decrement_ticket_stock', {
    p_ticket_type_id: checkout.ticket_type_id,
    p_quantity: checkout.quantity,
  })

  if (stockErr || !stock || (stock as unknown[]).length === 0) {
    await supabase.from('pending_checkouts').update({ status: 'failed' }).eq('id', checkout.id)
    throw new Error('sold_out')
  }

  const ticketIds: string[] = []
  const accessTokens: string[] = []

  const { data: countRow } = await supabase
    .from('tickets')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', checkout.tenant_id)

  let seq = (countRow as { count?: number } | null)?.count ?? Date.now() % 100000

  for (let i = 0; i < checkout.quantity; i++) {
    const secret = new OTPAuth.Secret({ size: 20 }).base32
    const access = randomToken(18)
    seq += 1
    const serial = nextSerial(seq)

    const { data: ticket, error } = await supabase
      .from('tickets')
      .insert({
        ticket_type_id: checkout.ticket_type_id,
        event_id: checkout.event_id,
        tenant_id: checkout.tenant_id,
        buyer_phone: checkout.buyer_phone,
        buyer_name: checkout.buyer_name,
        buyer_email: checkout.buyer_email,
        serial,
        totp_secret_enc: encryptSecret(secret, totpKey()),
        status: 'issued',
        issued_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (error || !ticket) throw new Error(error?.message ?? 'ticket_insert_failed')

    await supabase.from('ticket_access').insert({
      ticket_id: ticket.id,
      token_hash: sha256Hex(access),
    })

    await supabase.from('ownership_history').insert({
      ticket_id: ticket.id,
      to_phone: checkout.buyer_phone,
      reason: 'purchase',
    })

    await supabase.from('ticket_payments').insert({
      ticket_id: ticket.id,
      tenant_id: checkout.tenant_id,
      paystack_ref: `${checkout.paystack_ref}-${i + 1}`,
      amount_pesewas: Math.round(checkout.amount_pesewas / checkout.quantity),
      fee_pesewas: opts?.fee_pesewas ?? 0,
      status: 'successful',
      method: opts?.method === 'card' || opts?.method === 'ussd' ? opts.method : 'momo',
      webhook_received_at: new Date().toISOString(),
    })

    ticketIds.push(ticket.id)
    accessTokens.push(access)
  }

  await supabase.from('pending_checkouts').update({ status: 'issued' }).eq('id', checkout.id)

  const perTicket = Math.round(checkout.amount_pesewas / checkout.quantity)
  for (const id of ticketIds) {
    await supabase.from('ledger_entries').insert([
      {
        tenant_id: checkout.tenant_id,
        event_id: checkout.event_id,
        account: 'momo_clearing',
        direction: 'DR',
        amount_pesewas: perTicket,
        ref_type: 'ticket_payment',
        ref_id: id,
        memo: checkout.paystack_ref,
      },
      {
        tenant_id: checkout.tenant_id,
        event_id: checkout.event_id,
        account: 'ticket_revenue',
        direction: 'CR',
        amount_pesewas: perTicket,
        ref_type: 'ticket_payment',
        ref_id: id,
        memo: checkout.paystack_ref,
      },
    ])
  }

  return { ticket_ids: ticketIds, access_tokens: accessTokens }
}
