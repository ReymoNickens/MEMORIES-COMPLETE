import { NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { getStaffSession } from '@/lib/staff-session'

// Returns the current open shift plus the waiter cash summary for the shift-close page.
export async function GET() {
  const staff = await getStaffSession()
  if (!staff || !(staff.roles.includes('owner') || staff.roles.includes('manager'))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const supabase = createSupabaseServiceRole()
  const { data: open } = await supabase
    .from('shifts')
    .select('id')
    .eq('tenant_id', staff.tenant_id)
    .is('closed_at', null)
    .maybeSingle()

  if (!open) return NextResponse.json({ error: 'No open shift found' }, { status: 404 })

  const { data: waiters } = await supabase.rpc('get_waiter_cash_summary', { p_shift_id: open.id })
  return NextResponse.json({ shift_id: open.id, waiters: waiters ?? [] })
}

export async function POST() {
  const staff = await getStaffSession()
  if (!staff || !(staff.roles.includes('owner') || staff.roles.includes('manager'))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const supabase = createSupabaseServiceRole()
  const { data: open } = await supabase
    .from('shifts')
    .select('id')
    .eq('tenant_id', staff.tenant_id)
    .is('closed_at', null)
    .maybeSingle()
  if (open) return NextResponse.json({ shift_id: open.id, already_open: true })

  const { data, error } = await supabase.from('shifts').insert({
    tenant_id: staff.tenant_id,
    opened_by: staff.user_id,
  }).select('id').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ shift_id: data.id })
}
