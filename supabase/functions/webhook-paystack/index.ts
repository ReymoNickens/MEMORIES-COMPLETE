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

async function issueTickets(ref: string, _metadata: Record<string, unknown>) {
  // Look up pending_checkout by paystack_ref to get all context atomically
  const { data: checkout } = await supabase
    .from('pending_checkouts')
    .select('*')
    .eq('paystack_ref', ref)
    .neq('status', 'issued')
    .maybeSingle()

  if (!checkout) return  // Already issued (deduplication) or no checkout for this ref

  const { id: checkoutId, tenant_id, event_id, ticket_type_id, quantity,
          buyer_name, buyer_phone, buyer_email, amount_pesewas } = checkout

  // Generate all per-ticket material before the atomic RPC
  const totpSecretsEnc: string[] = []
  const serials: string[] = []
  const tokenHashes: string[] = []
  const rawTokens: string[] = []

  for (let i = 0; i < quantity; i++) {
    // Generate a proper base32-encoded TOTP secret (20 random bytes)
    const secretBytes = crypto.getRandomValues(new Uint8Array(20))
    const secretBase32 = toBase32(secretBytes)
    totpSecretsEnc.push(await encryptSecret(new TextEncoder().encode(secretBase32)))

    const year = new Date().getFullYear()
    serials.push(`MNC-${year}-${toHex(crypto.getRandomValues(new Uint8Array(4))).toUpperCase()}`)

    const rawToken = toHex(crypto.getRandomValues(new Uint8Array(18)))
    rawTokens.push(rawToken)
    tokenHashes.push(await sha256Hex(rawToken))
  }

  // Atomic: stock decrement + all ticket inserts + ledger entries in one transaction
  const { data, error } = await supabase.rpc('issue_tickets_atomic', {
    p_checkout_id:    checkoutId,
    p_tenant_id:      tenant_id,
    p_event_id:       event_id,
    p_ticket_type_id: ticket_type_id,
    p_quantity:       quantity,
    p_buyer_name:     buyer_name,
    p_buyer_phone:    buyer_phone,
    p_buyer_email:    buyer_email,
    p_paystack_ref:   ref,
    p_amount_pesewas: amount_pesewas,
    p_fee_pesewas:    0,
    p_method:         'momo',
    p_totp_secrets:   totpSecretsEnc,
    p_serials:        serials,
    p_token_hashes:   tokenHashes,
  })

  if (error) {
    if (error.message?.includes('sold_out')) {
      await triggerRefund(ref, 'sold_out')
    } else {
      console.error('issue_tickets_atomic failed:', error.message)
    }
    return
  }

  const ticketIds = ((data ?? []) as Array<{ ticket_id: string }>).map(r => r.ticket_id)

  // Fetch event name for notification
  const { data: event } = await supabase
    .from('events')
    .select('name, starts_at')
    .eq('id', event_id)
    .single()

  const appUrl = Deno.env.get('NEXT_PUBLIC_APP_URL') ?? ''

  // Send ticket delivery notifications
  for (let i = 0; i < ticketIds.length; i++) {
    const ticketId = ticketIds[i]
    const serial = serials[i]
    const rawToken = rawTokens[i]
    if (!ticketId) continue
    await sendNotification({
      buyerPhone: buyer_phone,
      buyerName: buyer_name,
      eventName: (event as { name: string } | null)?.name ?? 'Your event',
      eventDate: (event as { starts_at: string } | null)?.starts_at ?? '',
      ticketSerial: serial ?? ticketId,
      deepLink: `${appUrl}/tickets/${ticketId}?access=${rawToken}`,
    })
  }
}

async function markOrderPaid(ref: string, metadata: Record<string, unknown>) {
  const orderId = metadata['order_id'] as string

  const { data: updated } = await supabase
    .from('orders')
    .update({ status: 'paid', paid_at: new Date().toISOString(), paystack_ref: ref })
    .eq('id', orderId)
    .eq('status', 'pending_payment')
    .select('id, tenant_id, amount_pesewas')
    .single()

  if (updated) {
    const { data: paymentRow } = await supabase
      .from('ticket_payments')
      .select('id')
      .eq('paystack_ref', ref)
      .single()

    const paymentId = paymentRow?.id ?? orderId

    await supabase.from('ledger_entries').insert([
      {
        tenant_id: updated.tenant_id,
        account: 'momo_clearing',
        direction: 'DR',
        amount_pesewas: updated.amount_pesewas,
        ref_type: 'order_payment',
        ref_id: paymentId,
        memo: `Order payment: ${orderId}`,
      },
      {
        tenant_id: updated.tenant_id,
        account: 'fb_revenue',
        direction: 'CR',
        amount_pesewas: updated.amount_pesewas,
        ref_type: 'order_payment',
        ref_id: paymentId,
      },
    ])
  }

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

// ── Encoding helpers ─────────────────────────────────────────────────────────

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function toBase32(bytes: Uint8Array): string {
  let result = ''
  let bits = 0
  let value = 0
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      result += BASE32_CHARS[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) result += BASE32_CHARS[(value << (5 - bits)) & 31]
  return result
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return toHex(new Uint8Array(hash))
}

// ── Notification delivery ─────────────────────────────────────────────────────

async function sendNotification(params: {
  buyerPhone: string; buyerName: string; eventName: string
  eventDate: string; ticketSerial: string; deepLink: string
}): Promise<void> {
  const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')
  const accessToken = Deno.env.get('WHATSAPP_ACCESS_TOKEN')

  if (phoneNumberId && accessToken) {
    try {
      const res = await fetch(
        `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: params.buyerPhone.replace('+', ''),
            type: 'template',
            template: {
              name: 'ticket_delivery',
              language: { code: 'en' },
              components: [{
                type: 'body',
                parameters: [
                  { type: 'text', text: params.buyerName },
                  { type: 'text', text: params.eventName },
                  { type: 'text', text: params.eventDate },
                  { type: 'text', text: params.deepLink },
                  { type: 'text', text: params.ticketSerial },
                ],
              }],
            },
          }),
        }
      )
      if (res.ok) return
      console.error('WhatsApp delivery failed, status:', res.status)
    } catch (err) {
      console.error('WhatsApp delivery error:', err)
    }
  }

  // SMS fallback via Arkesel
  const apiKey = Deno.env.get('ARKESEL_API_KEY')
  const senderId = Deno.env.get('ARKESEL_SENDER_ID') ?? 'Memories'
  if (!apiKey) {
    console.error('No notification credentials — delivery not sent for', params.ticketSerial)
    return
  }
  try {
    const res = await fetch('https://sms.arkesel.com/api/v2/sms/send', {
      method: 'POST',
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: senderId,
        message: `Your ${params.eventName} ticket is ready. View it here: ${params.deepLink} — Memories Night Club`,
        recipients: [params.buyerPhone],
      }),
    })
    if (!res.ok) console.error('Arkesel SMS error:', res.status)
  } catch (err) {
    console.error('Arkesel SMS error:', err)
  }
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
  const secret = Deno.env.get('PAYSTACK_SECRET_KEY')
  if (!secret) {
    console.error(`Cannot refund ref=${ref}: PAYSTACK_SECRET_KEY not set. Reason: ${reason}`)
    return
  }
  const res = await fetch('https://api.paystack.co/refund', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ transaction: ref, merchant_note: reason }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`Paystack refund failed for ref=${ref}: ${res.status} ${body}`)
  } else {
    console.log(`Paystack refund initiated for ref=${ref}`)
  }
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
