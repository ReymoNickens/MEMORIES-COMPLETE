import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { getStaffSession } from '@/lib/staff-session'

export async function GET() {
  const staff = await getStaffSession()
  if (!staff) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const supabase = createSupabaseServiceRole()
  let q = supabase.from('organiser_submissions').select('*').eq('tenant_id', staff.tenant_id).order('created_at', { ascending: false })
  if (staff.roles.includes('organiser') && !staff.roles.includes('owner') && !staff.roles.includes('manager')) {
    q = q.eq('organiser_id', staff.user_id)
  }
  const { data } = await q
  return NextResponse.json({ submissions: data ?? [] })
}

export async function POST(req: NextRequest) {
  const staff = await getStaffSession()
  const canSubmit = staff?.roles.includes('organiser') || staff?.roles.includes('owner') || staff?.roles.includes('manager')
  if (!staff || !canSubmit) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body?.event_name || !body?.preferred_date || !body?.description) {
    return NextResponse.json({ error: 'missing fields' }, { status: 400 })
  }
  const supabase = createSupabaseServiceRole()
  const { data, error } = await supabase.from('organiser_submissions').insert({
    tenant_id: staff.tenant_id,
    organiser_id: staff.user_id,
    preferred_date: body.preferred_date,
    event_name: body.event_name,
    host_name: body.host_name ?? staff.full_name,
    description: body.description,
    estimated_attendance: body.estimated_attendance ?? 100,
    dj_details: body.dj_details ?? null,
    comp_allowance: body.comp_allowance ?? 0,
    special_requirements: body.special_requirements ?? null,
  }).select('id').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ id: data.id })
}

export async function PATCH(req: NextRequest) {
  const staff = await getStaffSession()
  if (!staff || !(staff.roles.includes('owner') || staff.roles.includes('manager'))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const body = await req.json().catch(() => null) as { id?: string; status?: string; decline_reason?: string } | null
  if (!body?.id || !['approved', 'declined'].includes(body.status ?? '')) {
    return NextResponse.json({ error: 'id and status required' }, { status: 400 })
  }
  const supabase = createSupabaseServiceRole()
  await supabase.from('organiser_submissions').update({
    status: body.status,
    reviewed_by: staff.user_id,
    reviewed_at: new Date().toISOString(),
    decline_reason: body.decline_reason ?? null,
  }).eq('id', body.id).eq('tenant_id', staff.tenant_id)
  return NextResponse.json({ ok: true })
}
