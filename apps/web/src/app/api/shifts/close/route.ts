import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { getStaffSession } from '@/lib/staff-session'

export async function POST(req: NextRequest) {
  const staff = await getStaffSession()
  if (!staff || !(staff.roles.includes('owner') || staff.roles.includes('manager'))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({})) as {
    shift_id?: string
    notes?: string
    hand_ins?: Array<{ waiter_id: string; physical_amount_pesewas: number }>
  }

  const supabase = createSupabaseServiceRole()
  const { data: shift } = await supabase
    .from('shifts')
    .select('id, closed_at')
    .eq('id', body.shift_id)
    .eq('tenant_id', staff.tenant_id)
    .single()

  if (!shift || shift.closed_at) {
    return NextResponse.json({ error: 'shift not open' }, { status: 409 })
  }

  for (const row of body.hand_ins ?? []) {
    await supabase
      .from('cash_collections')
      .update({
        handed_in_at: new Date().toISOString(),
        physical_amount_pesewas: row.physical_amount_pesewas,
      })
      .eq('shift_id', shift.id)
      .eq('attributed_waiter_id', row.waiter_id)
      .is('handed_in_at', null)
  }

  await supabase.from('shifts').update({
    closed_at: new Date().toISOString(),
    closed_by: staff.user_id,
    notes: body.notes ?? null,
  }).eq('id', shift.id)

  const { data: revenue } = await supabase.rpc('get_shift_revenue', { p_shift_id: shift.id })
  const { data: waiters } = await supabase.rpc('get_waiter_cash_summary', { p_shift_id: shift.id })
  return NextResponse.json({ ok: true, revenue, waiters })
}
