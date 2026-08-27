interface WhatsAppComponent {
  type: string
  parameters: Array<{ type: string; text: string }>
}

interface WhatsAppParams {
  to: string
  template: string
  components: WhatsAppComponent[]
}

export async function sendTicketDelivery(params: {
  buyerPhone: string
  buyerName: string
  eventName: string
  eventDate: string
  ticketSerial: string
  deepLink: string
  venueName: string
}): Promise<void> {
  // Try WhatsApp first
  try {
    await sendWhatsApp({
      to: params.buyerPhone,
      template: 'ticket_delivery',
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: params.buyerName },
            { type: 'text', text: params.eventName },
            { type: 'text', text: params.eventDate },
            { type: 'text', text: params.deepLink },
            { type: 'text', text: params.ticketSerial },
          ],
        },
      ],
    })
    return
  } catch (err) {
    console.error('WhatsApp delivery failed, falling back to SMS:', err instanceof Error ? err.message : 'unknown error')
  }

  // SMS fallback
  await sendSMS({
    to: params.buyerPhone,
    message: `Your ${params.eventName} ticket is ready. View it here: ${params.deepLink} — ${params.venueName}`,
  })
}

export async function sendCancellationNotice(params: {
  buyerPhone: string
  buyerName: string
  refundAmount: string
}): Promise<void> {
  try {
    await sendWhatsApp({
      to: params.buyerPhone,
      template: 'ticket_cancellation',
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: params.buyerName },
            { type: 'text', text: params.refundAmount },
          ],
        },
      ],
    })
    return
  } catch (err) {
    console.error('WhatsApp cancellation notice failed, falling back to SMS:', err instanceof Error ? err.message : 'unknown error')
  }

  await sendSMS({
    to: params.buyerPhone,
    message: `Your reservation has been cancelled. A refund of ${params.refundAmount} is being processed.`,
  })
}

async function sendWhatsApp(params: WhatsAppParams): Promise<void> {
  const phoneNumberId = process.env['WHATSAPP_PHONE_NUMBER_ID']
  const accessToken = process.env['WHATSAPP_ACCESS_TOKEN']

  if (!phoneNumberId || !accessToken) {
    throw new Error('WhatsApp credentials not configured')
  }

  const res = await fetch(
    `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: params.to.replace('+', ''),
        type: 'template',
        template: {
          name: params.template,
          language: { code: 'en' },
          components: params.components,
        },
      }),
    }
  )
  if (!res.ok) throw new Error(`WhatsApp API error: ${res.status}`)
}

async function sendSMS(params: { to: string; message: string }): Promise<void> {
  const apiKey = process.env['ARKESEL_API_KEY']
  const senderId = process.env['ARKESEL_SENDER_ID'] ?? 'Memories'

  if (!apiKey) throw new Error('Arkesel API key not configured')

  const res = await fetch('https://sms.arkesel.com/api/v2/sms/send', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender: senderId,
      message: params.message,
      recipients: [params.to],
    }),
  })
  if (!res.ok) throw new Error(`Arkesel SMS error: ${res.status}`)
}
