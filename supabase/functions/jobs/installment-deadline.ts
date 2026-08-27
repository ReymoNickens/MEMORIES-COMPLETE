import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

Deno.serve(async (req) => {
  // Verify cron secret
  const cronSecret = Deno.env.get('CRON_SECRET')
  if (req.headers.get('x-cron-secret') !== cronSecret) {
    return new Response('Unauthorized', { status: 401 })
  }

  const { data: expiredPlans } = await supabase
    .from('payment_plans')
    .select('id, ticket_id, total_pesewas, paid_pesewas')
    .eq('status', 'active')
    .lt('deadline_at', new Date().toISOString())

  let processed = 0

  for (const plan of (expiredPlans ?? [])) {
    try {
      await processExpiredPlan(plan as { id: string; ticket_id: string; total_pesewas: number; paid_pesewas: number })
      processed++
    } catch (err) {
      console.error(`Failed to process plan ${plan.id}:`, (err as Error).message)
    }
  }

  return new Response(JSON.stringify({ processed }), { status: 200 })
})

async function processExpiredPlan(plan: {
  id: string
  ticket_id: string
  total_pesewas: number
  paid_pesewas: number
}) {
  // 1. Mark plan as defaulted
  await supabase
    .from('payment_plans')
    .update({ status: 'defaulted' })
    .eq('id', plan.id)

  // 2. Void the ticket
  await supabase
    .from('tickets')
    .update({ status: 'voided', voided_at: new Date().toISOString(), voided_reason: 'installment_defaulted' })
    .eq('id', plan.ticket_id)

  // 3. Create revocation record
  await supabase
    .from('revocations')
    .insert({ ticket_id: plan.ticket_id, reason: 'installment_defaulted' })

  // 4. Get ticket info for notification
  const { data: ticket } = await supabase
    .from('tickets')
    .select('buyer_phone, buyer_name, tenant_id')
    .eq('id', plan.ticket_id)
    .single()

  if (!ticket) return

  // 5. Refund paid amounts (10% forfeiture)
  const { data: payments } = await supabase
    .from('ticket_payments')
    .select('id, paystack_ref, amount_pesewas')
    .eq('ticket_id', plan.ticket_id)
    .eq('status', 'successful')

  const forfeiturePercentage = 0.10
  const forfeiturePesewas = Math.round(plan.total_pesewas * forfeiturePercentage)

  for (const payment of (payments ?? [])) {
    const refundAmount = Math.max(0, (payment.amount_pesewas as number) - Math.round(forfeiturePesewas / (payments?.length ?? 1)))

    try {
      const refundRef = `refund-${payment.id}-${Date.now()}`
      const res = await fetch(`https://api.paystack.co/refund`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${Deno.env.get('PAYSTACK_SECRET_KEY')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transaction: payment.paystack_ref,
          amount: refundAmount,
          merchant_note: 'Installment plan default — partial refund',
        }),
      })

      if (res.ok) {
        await supabase
          .from('ticket_payments')
          .update({ status: 'refunded', refund_ref: refundRef, refunded_at: new Date().toISOString() })
          .eq('id', payment.id)
      }
    } catch (err) {
      console.error(`Refund failed for payment ${payment.id}:`, (err as Error).message)
    }
  }

  // 6. Write forfeiture ledger entry
  if (forfeiturePesewas > 0) {
    await supabase.from('ledger_entries').insert({
      tenant_id: ticket.tenant_id,
      account: 'forfeiture_income',
      direction: 'CR',
      amount_pesewas: forfeiturePesewas,
      ref_type: 'void',
      ref_id: plan.id,
      memo: `Installment forfeiture: ${plan.ticket_id}`,
    })
  }

  // 7. Notify buyer via WhatsApp/SMS
  const refundGHS = ((plan.paid_pesewas - forfeiturePesewas) / 100).toFixed(2)
  await notifyBuyer(ticket.buyer_phone as string, ticket.buyer_name as string, `GHS ${refundGHS}`)
}

async function notifyBuyer(phone: string, name: string, refundAmount: string): Promise<void> {
  const accessToken = Deno.env.get('WHATSAPP_ACCESS_TOKEN')
  const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')

  if (!accessToken || !phoneNumberId) {
    console.warn('WhatsApp not configured; skipping notification')
    return
  }

  try {
    await fetch(`https://graph.facebook.com/v18.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone.replace('+', ''),
        type: 'template',
        template: {
          name: 'ticket_cancellation',
          language: { code: 'en' },
          components: [{
            type: 'body',
            parameters: [
              { type: 'text', text: name },
              { type: 'text', text: refundAmount },
            ],
          }],
        },
      }),
    })
  } catch (err) {
    console.error('WhatsApp notification failed:', (err as Error).message)
    // SMS fallback
    await sendSmsFallback(phone, `Your reservation has been cancelled. A refund of ${refundAmount} is being processed. — Memories Night Club`)
  }
}

async function sendSmsFallback(to: string, message: string): Promise<void> {
  const apiKey = Deno.env.get('ARKESEL_API_KEY')
  if (!apiKey) return
  await fetch('https://sms.arkesel.com/api/v2/sms/send', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sender: 'Memories', message, recipients: [to] }),
  })
}
