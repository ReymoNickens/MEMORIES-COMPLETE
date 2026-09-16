import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { getStaffSession } from '@/lib/staff-session'

// Snapshots any real shortage (counted product, consumed more than the till
// plus logged adjustments account for) into stock_shortages for follow-up.
// Manager/owner only — this is the step that turns a number on a report
// into a named, tracked problem.
export async function POST(req: NextRequest) {
  const staff = await getStaffSession()
  if (!staff || !staff.roles.some(r => ['manager', 'owner'].includes(r))) {
    return NextResponse.json({ error: 'forbidden' }, { status: staff ? 403 : 401 })
  }

  const body = await req.json().catch(() => null) as { shift_id?: string } | null
  if (!body?.shift_id) return NextResponse.json({ error: 'shift_id is required' }, { status: 400 })

  const supabase = createSupabaseServiceRole()

  const { data: shift } = await supabase.from('shifts').select('id').eq('id', body.shift_id).eq('tenant_id', staff.tenant_id).maybeSingle()
  if (!shift) return NextResponse.json({ error: 'shift not found' }, { status: 404 })

  const { data, error } = await supabase.rpc('finalize_stock_reconciliation', {
    p_shift_id: body.shift_id,
    p_actor_id: staff.user_id,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
