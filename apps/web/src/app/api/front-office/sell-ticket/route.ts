import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { getStaffSession } from '@/lib/staff-session'
import { normalisePhone } from '@evolveit/shared/phone'
import { issueTicketsFromCheckout } from '@/lib/issue-tickets'

// Front Office's walk-up ticket sale — a staff-initiated version of the
// self-service /api/checkout/initiate flow, reusing the same checkout
// validation, but for cash collected in hand rather than a Paystack charge.
export async function POST(req: NextRequest) {
  const staff = await getStaffSession()
  if (!staff || !staff.roles.some(r => ['front_office', 'door', 'owner', 'manager', 'event_manager'].includes(r))) {
    return NextResponse.json({ error: 'forbidden' }, { status: staff ? 403 : 401 })
  }

  const body = await req.json().catch(() => null) as {
    ticket_type_id?: string
    quantity?: number
    buyer_name?: string
    buyer_phone?: string
    buyer_email?: string
  } | null

  if (!body?.ticket_type_id || !body.buyer_name || !body.buyer_phone) {
    return NextResponse.json({ error: 'ticket_type_id, buyer_name and buyer_phone are required' }, { status: 400 })
  }
  const phone = normalisePhone(body.buyer_phone)
  if (!phone) return NextResponse.json({ error: 'Invalid Ghana phone number' }, { status: 400 })

  const qty = Math.min(Math.max(1, body.quantity ?? 1), 6)
  const supabase = createSupabaseServiceRole()

  const { data: ticketType } = await supabase
    .from('ticket_types')
    .select('*, events(*)')
    .eq('id', body.ticket_type_id)
    .eq('tenant_id', staff.tenant_id)
    .maybeSingle()
  if (!ticketType) return NextResponse.json({ error: 'Ticket type not found' }, { status: 404 })

  const event = ticketType.events as { id: string; status: string }
  if (event.status !== 'published') {
    return NextResponse.json({ error: 'Event is not on sale' }, { status: 400 })
  }
  if ((ticketType.remaining as number) < qty) {
    return NextResponse.json({ error: 'Not enough tickets available' }, { status: 409 })
  }

  const now = new Date()
  if (now < new Date(ticketType.sale_starts_at as string) || now > new Date(ticketType.sale_ends_at as string)) {
    return NextResponse.json({ error: 'Ticket sales are not open' }, { status: 400 })
  }

  const totalPesewas = (ticketType.price_pesewas as number) * qty
  const cashRef = `cash_${randomBytes(12).toString('hex')}`

  const { data: checkout, error: insertError } = await supabase.from('pending_checkouts').insert({
    tenant_id: staff.tenant_id,
    ticket_type_id: body.ticket_type_id,
    event_id: ticketType.event_id,
    quantity: qty,
    buyer_name: body.buyer_name,
    buyer_phone: phone,
    buyer_email: body.buyer_email || `${phone.replace('+', '')}@walkup.mnc`,
    amount_pesewas: totalPesewas,
    paystack_ref: cashRef,
    status: 'paid',
  }).select('id, tenant_id, event_id').single()

  if (insertError || !checkout) {
    return NextResponse.json({ error: insertError?.message ?? 'Could not start the sale' }, { status: 500 })
  }

  try {
    const result = await issueTicketsFromCheckout(supabase, {
      id: checkout.id,
      tenant_id: checkout.tenant_id as string,
      event_id: checkout.event_id as string,
      quantity: qty,
      amount_pesewas: totalPesewas,
      paystack_ref: cashRef,
      buyer_name: body.buyer_name,
      buyer_phone: phone,
    }, { cashWaiterId: staff.user_id })

    return NextResponse.json({ ok: true, ticket_ids: result.ticket_ids, amount_pesewas: totalPesewas })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'issue_failed'
    if (msg === 'sold_out') return NextResponse.json({ error: 'Sold out — someone else took the last one' }, { status: 409 })
    if (msg === 'cash_needs_waiter_and_shift') {
      return NextResponse.json({ error: 'No shift is open — open the night before selling on the door' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Could not complete the sale' }, { status: 500 })
  }
}
