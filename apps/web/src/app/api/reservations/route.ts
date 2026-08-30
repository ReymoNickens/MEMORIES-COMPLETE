import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { getStaffSession } from '@/lib/staff-session'
import { normalisePhone } from '@evolveit/shared/phone'
import { randomBytes } from 'node:crypto'
import { initializeCharge } from '@/lib/paystack'
import { demoPaymentsAllowed, paymentsConfigured } from '@/lib/runtime'
import { enqueue } from '@/lib/outbox'

export async function GET() {
  const staff = await getStaffSession()
  if (!staff) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const supabase = createSupabaseServiceRole()
  const { data } = await supabase
    .from('table_reservations')
    .select('*, venue_tables(label, zone, seats), events(name, starts_at)')
    .eq('tenant_id', staff.tenant_id)
    .order('reserved_for')
  return NextResponse.json({ reservations: data ?? [] })
}

export async function POST(req: NextRequest) {
  const staff = await getStaffSession()
  if (!staff) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null) as {
    venue_table_id?: string
    event_id?: string
    guest_name?: string
    guest_phone?: string
    reserved_for?: string
    deposit_pesewas?: number
  } | null

  const phone = normalisePhone(body?.guest_phone ?? '')
  if (!body?.venue_table_id || !body.guest_name || !phone || !body.reserved_for) {
    return NextResponse.json({ error: 'missing fields' }, { status: 400 })
  }

  const deposit = Math.max(0, Math.round(Number(body.deposit_pesewas ?? 0)))
  const supabase = createSupabaseServiceRole()

  // A deposit reservation needs a reference before it is written, so the
  // webhook has something to match the charge against.
  const depositRef = deposit > 0 ? `mnc_dep_${randomBytes(12).toString('hex')}` : null

  if (deposit > 0 && !paymentsConfigured()) {
    return NextResponse.json(
      { error: 'Payments are not configured — hold the table without a deposit' },
      { status: 503 },
    )
  }

  const { data, error } = await supabase.from('table_reservations').insert({
    tenant_id: staff.tenant_id,
    venue_table_id: body.venue_table_id,
    event_id: body.event_id ?? null,
    guest_name: body.guest_name,
    guest_phone: phone,
    reserved_for: body.reserved_for,
    deposit_pesewas: deposit,
    paystack_ref: depositRef,
    status: deposit > 0 ? 'pending' : 'confirmed',
  }).select('id').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (deposit === 0) return NextResponse.json({ id: data.id, status: 'confirmed' })

  // Previously the deposit was recorded and never charged: the reservation sat
  // pending forever, the confirm-on-webhook branch never fired, and the
  // no-show job had nothing to forfeit. Raise the charge and text the guest
  // the link — they are on the phone to the floor, not at a browser.
  if (demoPaymentsAllowed()) {
    await supabase.rpc('confirm_reservation_deposit', {
      p_reservation_id: data.id,
      p_paid_pesewas: deposit,
      p_paystack_ref: depositRef,
    })
    return NextResponse.json({ id: data.id, status: 'confirmed', demo: true })
  }

  const charge = await initializeCharge({
    email: `${phone.replace('+', '')}@momo.gh`,
    amountPesewas: deposit,
    reference: depositRef!,
    callbackPath: `/checkout/return?ref=${depositRef}`,
    metadata: { context: 'reservation_deposit', reservation_id: data.id },
  })

  if (!charge.ok) {
    // The hold stands; the deposit can be taken again from the floor screen.
    return NextResponse.json(
      { id: data.id, status: 'pending', deposit_error: 'Could not raise the deposit charge' },
      { status: 502 },
    )
  }

  await enqueue(supabase, [{
    tenant_id: staff.tenant_id,
    kind: 'reservation_deposit',
    to_phone: phone,
    payload: {
      buyer_name: body.guest_name,
      event_name: 'Memories Night Club',
      event_date: new Date(body.reserved_for).toLocaleString('en-GH', {
        weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      }),
      reference: depositRef!,
      deep_link: charge.data.authorization_url,
    },
    dedupe_key: `deposit:${data.id}`,
  }])

  return NextResponse.json({
    id: data.id,
    status: 'pending',
    authorization_url: charge.data.authorization_url,
    reference: depositRef,
  })
}

export async function PATCH(req: NextRequest) {
  const staff = await getStaffSession()
  if (!staff) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null) as { id?: string; status?: string } | null
  const allowed = ['confirmed', 'arrived', 'no_show', 'cancelled']
  if (!body?.id || !allowed.includes(body.status ?? '')) {
    return NextResponse.json({ error: 'id and status required' }, { status: 400 })
  }
  const supabase = createSupabaseServiceRole()

  // Scope to the tenant before acting on it.
  const { data: existing } = await supabase
    .from('table_reservations')
    .select('id')
    .eq('id', body.id)
    .eq('tenant_id', staff.tenant_id)
    .maybeSingle()
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 })

  // A no-show forfeits the deposit, which is a transfer out of the liability
  // the club is holding — not a status flag. Marking it by hand from the floor
  // has to book the same entries the overnight job does.
  if (body.status === 'no_show') {
    const { data, error } = await supabase.rpc('forfeit_reservation_deposit', {
      p_reservation_id: body.id,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ ok: true, ...(data as Record<string, unknown>) })
  }

  const patch: Record<string, unknown> = { status: body.status }
  if (body.status === 'arrived') patch.arrived_at = new Date().toISOString()
  if (body.status === 'cancelled') patch.cancelled_at = new Date().toISOString()
  await supabase.from('table_reservations').update(patch).eq('id', body.id).eq('tenant_id', staff.tenant_id)
  return NextResponse.json({ ok: true })
}
