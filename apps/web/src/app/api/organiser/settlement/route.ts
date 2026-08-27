import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { getStaffSession } from '@/lib/staff-session'

export async function GET(req: NextRequest) {
  const staff = await getStaffSession()
  if (!staff) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const eventId = req.nextUrl.searchParams.get('event_id')
  const supabase = createSupabaseServiceRole()
  if (eventId) {
    const { data } = await supabase.rpc('compute_settlement', { p_event_id: eventId })
    return NextResponse.json({ settlement: data })
  }
  const { data } = await supabase
    .from('settlement_statements')
    .select('*, events(name, starts_at)')
    .eq('tenant_id', staff.tenant_id)
    .order('created_at', { ascending: false })
  return NextResponse.json({ statements: data ?? [] })
}

export async function POST(req: NextRequest) {
  const staff = await getStaffSession()
  if (!staff || !(staff.roles.includes('owner') || staff.roles.includes('manager'))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const body = await req.json().catch(() => null) as { event_id?: string } | null
  if (!body?.event_id) return NextResponse.json({ error: 'event_id required' }, { status: 400 })
  const supabase = createSupabaseServiceRole()
  const { data: computed } = await supabase.rpc('compute_settlement', { p_event_id: body.event_id })
  const c = computed as Record<string, number>
  const { data: sub } = await supabase
    .from('organiser_submissions')
    .select('organiser_id')
    .eq('event_id', body.event_id)
    .maybeSingle()

  const { data, error } = await supabase.from('settlement_statements').upsert({
    tenant_id: staff.tenant_id,
    event_id: body.event_id,
    organiser_id: sub?.organiser_id ?? staff.user_id,
    gate_gross_pesewas: c.gate_gross,
    table_gross_pesewas: c.table_gross,
    refunds_pesewas: c.refunds,
    comps_pesewas: c.comps,
    comp_allowance_pesewas: c.comp_allowance,
    organiser_gate_pesewas: c.organiser_gate,
    organiser_table_pesewas: c.organiser_table,
    organiser_total_pesewas: c.organiser_total,
    club_total_pesewas: c.club_total,
    gate_split_club_bps: c.gate_split_club_bps,
    table_split_club_bps: c.table_split_club_bps,
    status: 'draft',
  }, { onConflict: 'event_id' }).select('id').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ id: data.id, settlement: c })
}

export async function PATCH(req: NextRequest) {
  const staff = await getStaffSession()
  if (!staff || !staff.roles.includes('owner')) {
    return NextResponse.json({ error: 'owner only' }, { status: 403 })
  }
  const body = await req.json().catch(() => null) as { id?: string; status?: string } | null
  if (!body?.id || !['approved', 'paid'].includes(body.status ?? '')) {
    return NextResponse.json({ error: 'id and status required' }, { status: 400 })
  }
  const supabase = createSupabaseServiceRole()
  const patch: Record<string, unknown> = { status: body.status }
  if (body.status === 'approved') {
    patch.approved_by = staff.user_id
    patch.approved_at = new Date().toISOString()
  }
  if (body.status === 'paid') patch.paid_at = new Date().toISOString()
  await supabase.from('settlement_statements').update(patch).eq('id', body.id)
  return NextResponse.json({ ok: true })
}
