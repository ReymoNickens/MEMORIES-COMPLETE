import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { getStaffSession } from '@/lib/staff-session'
import { normalisePhone } from '@evolveit/shared/phone'

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

  const supabase = createSupabaseServiceRole()
  const { data, error } = await supabase.from('table_reservations').insert({
    tenant_id: staff.tenant_id,
    venue_table_id: body.venue_table_id,
    event_id: body.event_id ?? null,
    guest_name: body.guest_name,
    guest_phone: phone,
    reserved_for: body.reserved_for,
    deposit_pesewas: body.deposit_pesewas ?? 0,
    status: (body.deposit_pesewas ?? 0) > 0 ? 'pending' : 'confirmed',
  }).select('id').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ id: data.id })
}

// Valid state transitions: current status → allowed next statuses
const RESERVATION_TRANSITIONS: Record<string, string[]> = {
  pending:   ['confirmed', 'cancelled'],
  confirmed: ['arrived', 'no_show', 'cancelled'],
  arrived:   [],
  no_show:   [],
  cancelled: [],
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

  // Validate transition against current state
  const { data: existing } = await supabase
    .from('table_reservations')
    .select('status')
    .eq('id', body.id)
    .eq('tenant_id', staff.tenant_id)
    .single()
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const validNext = RESERVATION_TRANSITIONS[existing.status as string] ?? []
  if (!validNext.includes(body.status!)) {
    return NextResponse.json({ error: `Cannot move from '${existing.status}' to '${body.status}'` }, { status: 409 })
  }

  const patch: Record<string, unknown> = { status: body.status }
  if (body.status === 'arrived') patch.arrived_at = new Date().toISOString()
  if (body.status === 'cancelled') patch.cancelled_at = new Date().toISOString()
  await supabase.from('table_reservations').update(patch).eq('id', body.id).eq('tenant_id', staff.tenant_id)
  return NextResponse.json({ ok: true })
}
