import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { getStaffSession } from '@/lib/staff-session'

/**
 * Everything the owner and duty manager need for the night, in one read.
 *
 * This used to be four queries fired from the browser with the public anon
 * key, two of them SECURITY DEFINER RPCs that bypass RLS — so the club's
 * takings and every server's cash variance were readable by anyone who opened
 * devtools. Those functions are now service-role only and this route is the
 * single door in front of them.
 */
export async function GET(req: NextRequest) {
  const staff = await getStaffSession()
  if (!staff || !(staff.roles.includes('owner') || staff.roles.includes('manager'))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const supabase = createSupabaseServiceRole()
  const requested = req.nextUrl.searchParams.get('shift_id')

  let shiftId = requested
  if (!shiftId) {
    const { data: open } = await supabase
      .from('shifts')
      .select('id')
      .eq('tenant_id', staff.tenant_id)
      .is('closed_at', null)
      .order('opened_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    // Nothing open — fall back to the last night that ran, so walking in the
    // morning after still shows you what happened rather than an empty screen.
    if (open) {
      shiftId = open.id as string
    } else {
      const { data: last } = await supabase
        .from('shifts')
        .select('id')
        .eq('tenant_id', staff.tenant_id)
        .order('opened_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      shiftId = (last?.id as string) ?? null
    }
  }

  if (!shiftId) {
    return NextResponse.json({ shift_id: null, dashboard: null, waiters: [] })
  }

  // Confirm the shift belongs to this tenant before handing over its numbers.
  const { data: shift } = await supabase
    .from('shifts')
    .select('id, opened_at, closed_at')
    .eq('id', shiftId)
    .eq('tenant_id', staff.tenant_id)
    .maybeSingle()

  if (!shift) return NextResponse.json({ error: 'shift not found' }, { status: 404 })

  const [{ data: dashboard }, { data: waiters }] = await Promise.all([
    supabase.rpc('get_night_dashboard', { p_shift_id: shift.id }),
    supabase.rpc('get_waiter_cash_summary', { p_shift_id: shift.id }),
  ])

  return NextResponse.json({
    shift_id: shift.id,
    open: !shift.closed_at,
    dashboard,
    waiters: waiters ?? [],
  })
}
