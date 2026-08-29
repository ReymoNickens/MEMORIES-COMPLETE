import { createHmac, timingSafeEqual } from 'node:crypto'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

function verifySignature(rawBody: ArrayBuffer, signature: string): boolean {
  const secret = Deno.env.get('PAYSTACK_WEBHOOK_SECRET')!
  const body = new Uint8Array(rawBody)
  const expected = createHmac('sha512', secret).update(body).digest('hex')
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(signature || '', 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

Deno.serve(async (req) => {
  // Always return 200 to Paystack — process async
  const rawBody = await req.arrayBuffer()
  const signature = req.headers.get('x-paystack-signature') || ''

  if (!verifySignature(rawBody, signature)) {
    console.error('HMAC verification failed')
    return new Response('Unauthorized', { status: 401 })
  }

  const payload = JSON.parse(new TextDecoder().decode(rawBody))
  const eventId = payload.data?.id?.toString() || payload.id?.toString()

  // Deduplication: insert webhook_event first
  const { error: dupError } = await supabase
    .from('webhook_events')
    .insert({ paystack_event_id: eventId, event_type: payload.event, raw_payload: payload })

  if (dupError?.code === '23505') {
    // Already processed — idempotent return
    return new Response(JSON.stringify({ ok: true, duplicate: true }), { status: 200 })
  }

  // Handle charge.success
  if (payload.event === 'charge.success') {
    await handleChargeSuccess(payload.data)
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 })
})

async function handleChargeSuccess(data: Record<string, unknown>) {
  const ref = data.reference as string
  const metadata = (data.metadata as Record<string, unknown>) || {}

  // Update payment record
  await supabase
    .from('ticket_payments')
    .update({
      status: 'successful',
      method: data.channel,
      fee_pesewas: (data.fees as number) || 0,
      webhook_received_at: new Date().toISOString(),
      raw_webhook: data,
    })
    .eq('paystack_ref', ref)

  // Context-based routing
  if (metadata['context'] === 'ticket') {
    await issueTickets(ref, metadata)
  } else if (metadata['context'] === 'order') {
    await markOrderPaid(ref, metadata)
  } else if (metadata['context'] === 'reservation_deposit') {
    await confirmReservation(ref, metadata)
  }
}

async function issueTickets(ref: string, metadata: Record<string, unknown>) {
  const ticketTypeId = metadata['ticket_type_id'] as string
  const buyerUserId = metadata['buyer_user_id'] as string | undefined
  const buyerPhone = metadata['buyer_phone'] as string
  const buyerName = metadata['buyer_name'] as string
  const buyerEmail = metadata['buyer_email'] as string
  const quantity = (metadata['quantity'] as number) || 1

  // Atomic stock decrement
  const { data: updated, error } = await supabase.rpc('decrement_ticket_stock', {
    p_ticket_type_id: ticketTypeId,
    p_quantity: quantity,
  })

  if (error || !updated || updated.length === 0) {
    // Stock exhausted — trigger refund
    await triggerRefund(ref, 'sold_out')
    return
  }

  const ticketTypeData = updated[0] as { event_id: string; tenant_id: string; price_pesewas: number; payment_id: string }

  // Retrieve the payment id for ledger entries
  const { data: paymentRow } = await supabase
    .from('ticket_payments')
    .select('id')
    .eq('paystack_ref', ref)
    .single()

  const paymentId = paymentRow?.id ?? ticketTypeData.payment_id

  // Create ticket(s) — generate TOTP secrets
  for (let i = 0; i < quantity; i++) {
    const serial = await generateSerial(ticketTypeData.tenant_id)
    const totpSecret = crypto.getRandomValues(new Uint8Array(20))
    const totpSecretEnc = await encryptSecret(totpSecret)

    const { error: ticketErr } = await supabase.from('tickets').insert({
      ticket_type_id: ticketTypeId,
      event_id: ticketTypeData.event_id,
      tenant_id: ticketTypeData.tenant_id,
      buyer_user_id: buyerUserId,
      buyer_phone: buyerPhone,
      buyer_name: buyerName,
      buyer_email: buyerEmail,
      serial,
      totp_secret_enc: totpSecretEnc,
      status: 'issued',
      issued_at: new Date().toISOString(),
    })

    if (ticketErr) {
      console.error('Failed to insert ticket:', ticketErr.message)
      continue
    }

    // Write ledger entries
    await supabase.from('ledger_entries').insert([
      {
        tenant_id: ticketTypeData.tenant_id,
        event_id: ticketTypeData.event_id,
        account: 'momo_clearing',
        direction: 'DR',
        amount_pesewas: ticketTypeData.price_pesewas,
        ref_type: 'ticket_payment',
        ref_id: paymentId,
        memo: `Ticket purchase: ${serial}`,
      },
      {
        tenant_id: ticketTypeData.tenant_id,
        event_id: ticketTypeData.event_id,
        account: 'ticket_revenue',
        direction: 'CR',
        amount_pesewas: ticketTypeData.price_pesewas,
        ref_type: 'ticket_payment',
        ref_id: paymentId,
      },
    ])

    // Enqueue WhatsApp delivery
    await enqueueDelivery({ type: 'ticket', ticket_serial: serial, buyer_phone: buyerPhone, buyer_name: buyerName })
  }
}

async function markOrderPaid(ref: string, metadata: Record<string, unknown>) {
  const orderId = metadata['order_id'] as string
  await supabase
    .from('orders')
    .update({ status: 'paid', paid_at: new Date().toISOString(), paystack_ref: ref })
    .eq('id', orderId)
    .eq('status', 'pending_payment')

  // Notify hub
  await notifyHub({ type: 'order_paid', order_id: orderId })
}

async function confirmReservation(ref: string, metadata: Record<string, unknown>) {
  const reservationId = metadata['reservation_id'] as string
  await supabase
    .from('table_reservations')
    .update({ status: 'confirmed', deposit_paid_at: new Date().toISOString(), paystack_ref: ref })
    .eq('id', reservationId)
    .eq('status', 'pending')
}

async function generateSerial(tenantId: string): Promise<string> {
  const year = new Date().getFullYear()
  const random = Math.random().toString(36).substring(2, 8).toUpperCase()
  return `MNC-${year}-${random}`
}

async function encryptSecret(secret: Uint8Array): Promise<string> {
  const keyHex = Deno.env.get('TOTP_ENCRYPTION_KEY')
  if (!keyHex || keyHex.length !== 64) throw new Error('TOTP_ENCRYPTION_KEY must be a 64-char hex string')

  const keyBytes = new Uint8Array(keyHex.match(/.{2}/g)!.map(b => parseInt(b, 16)))
  const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, cryptoKey, secret)

  const toHex = (b: Uint8Array) => Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('')
  const ctBytes = new Uint8Array(ct)
  // ct from AES-GCM includes the 16-byte auth tag appended at the end
  const ciphertext = ctBytes.slice(0, ctBytes.length - 16)
  const tag = ctBytes.slice(ctBytes.length - 16)
  return `${toHex(iv)}:${toHex(tag)}:${toHex(ciphertext)}`
}

async function triggerRefund(ref: string, reason: string): Promise<void> {
  console.error(`Refund required for ref=${ref}, reason=${reason}`)
  // TODO: call Paystack refund API
}

async function enqueueDelivery(payload: { type: string; ticket_serial: string; buyer_phone: string; buyer_name: string }): Promise<void> {
  // TODO: integrate with WhatsApp/SMS delivery queue
  console.log('Delivery queued:', payload.type, payload.ticket_serial)
}

async function notifyHub(event: { type: string; order_id: string }): Promise<void> {
  const hubUrl = Deno.env.get('HUB_LAN_URL') ?? 'http://hub.lan'
  const hubSecret = Deno.env.get('HUB_SECRET') ?? ''
  try {
    await fetch(`${hubUrl}/v1/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-hub-secret': hubSecret },
      body: JSON.stringify(event),
    })
  } catch {
    // Hub may be offline — that's expected; hub will sync on next interval
  }
}
