import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { issueTicketsFromCheckout } from '@/lib/issue-tickets'

function verify(raw: string, signature: string): boolean {
  const secret = process.env['PAYSTACK_WEBHOOK_SECRET']
  if (!secret) {
    console.error('PAYSTACK_WEBHOOK_SECRET is not set — rejecting webhook')
    return false
  }
  const expected = createHmac('sha512', secret).update(raw).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(signature || '')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export async function POST(req: NextRequest) {
  const raw = await req.text()
  const signature = req.headers.get('x-paystack-signature') || ''
  if (!verify(raw, signature)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  const payload = JSON.parse(raw) as { event?: string; data?: Record<string, unknown>; id?: string }
  const eventId = String(payload.data?.id ?? payload.id ?? signature.slice(0, 24))
  const supabase = createSupabaseServiceRole()

  const { error: dup } = await supabase.from('webhook_events').insert({
    paystack_event_id: eventId,
    event_type: payload.event ?? 'unknown',
    raw_payload: payload,
  })
  if (dup?.code === '23505') return NextResponse.json({ ok: true, duplicate: true })

  if (payload.event === 'charge.success' && payload.data) {
    const ref = payload.data.reference as string
    const { data: checkout } = await supabase.from('pending_checkouts').select('*').eq('paystack_ref', ref).maybeSingle()
    if (checkout && checkout.status !== 'issued') {
      await supabase.from('pending_checkouts').update({ status: 'paid' }).eq('id', checkout.id)
      await issueTicketsFromCheckout(supabase, checkout, {
        fee_pesewas: (payload.data.fees as number) || 0,
        method: payload.data.channel as string,
      })
    }

    const { data: order } = await supabase.from('orders').select('id').eq('paystack_ref', ref).maybeSingle()
    if (order) {
      await supabase.from('orders').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', order.id)
    }

    const { data: resv } = await supabase.from('table_reservations').select('id').eq('paystack_ref', ref).maybeSingle()
    if (resv) {
      await supabase.from('table_reservations').update({ status: 'confirmed', deposit_paid_at: new Date().toISOString() }).eq('id', resv.id)
    }
  }

  return NextResponse.json({ ok: true })
}
