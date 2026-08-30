import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { getStaffSession } from '@/lib/staff-session'

/**
 * Record one waiter's cash count. Separate from closing the night, because a
 * manager counts servers down one at a time as they finish, and the count has
 * to be on the record before anyone can close.
 */
export async function PATCH(req: NextRequest) {
  const staff = await getStaffSession()
  if (!staff || !(staff.roles.includes('owner') || staff.roles.includes('manager'))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => null) as {
    shift_id?: string
    waiter_id?: string
    physical_amount_pesewas?: number
    note?: string
  } | null

  const amount = body?.physical_amount_pesewas
  if (!body?.shift_id || !body.waiter_id || !Number.isInteger(amount) || amount! < 0) {
    return NextResponse.json({ error: 'shift_id, waiter_id and a whole-pesewa amount are required' }, { status: 400 })
  }

  const supabase = createSupabaseServiceRole()

  // Scope the shift to the caller's tenant before touching it.
  const { data: shift } = await supabase
    .from('shifts')
    .select('id, closed_at')
    .eq('id', body.shift_id)
    .eq('tenant_id', staff.tenant_id)
    .maybeSingle()

  if (!shift) return NextResponse.json({ error: 'shift not found' }, { status: 404 })
  if (shift.closed_at) return NextResponse.json({ error: 'shift already closed' }, { status: 409 })

  const { data, error } = await supabase.rpc('record_handover', {
    p_shift_id: body.shift_id,
    p_waiter_id: body.waiter_id,
    p_physical_pesewas: amount,
    p_counted_by: staff.user_id,
    p_note: body.note ?? null,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}

/**
 * Close the night.
 *
 * The previous version wrote the same physical_amount_pesewas onto every
 * cash_collections row belonging to a waiter, and get_waiter_cash_summary then
 * SUMmed those rows — so a waiter with 20 orders who handed in GHS 5,000
 * reconciled as GHS 100,000 handed in. Counts now live in shift_handovers, one
 * row per waiter per shift, and close_shift posts the variance to the ledger
 * inside the same transaction that stamps the shift closed.
 */
export async function POST(req: NextRequest) {
  const staff = await getStaffSession()
  if (!staff || !(staff.roles.includes('owner') || staff.roles.includes('manager'))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({})) as { shift_id?: string; notes?: string }
  if (!body.shift_id) {
    return NextResponse.json({ error: 'shift_id required' }, { status: 400 })
  }

  const supabase = createSupabaseServiceRole()
  const { data: shift } = await supabase
    .from('shifts')
    .select('id, closed_at')
    .eq('id', body.shift_id)
    .eq('tenant_id', staff.tenant_id)
    .maybeSingle()

  if (!shift || shift.closed_at) {
    return NextResponse.json({ error: 'shift not open' }, { status: 409 })
  }

  const { error } = await supabase.rpc('close_shift', {
    p_shift_id: shift.id,
    p_closed_by: staff.user_id,
    p_notes: body.notes ?? null,
  })

  if (error) {
    // close_shift refuses on unbilled tables and uncounted servers. Both are
    // things the manager must go and finish, so say which and how many.
    const msg = error.message ?? ''
    const tabs = /open_tabs_remain:(\d+)/.exec(msg)
    if (tabs) {
      return NextResponse.json(
        { error: `${tabs[1]} table${tabs[1] === '1' ? '' : 's'} still on an open tab. Bill them first.`, code: 'OPEN_TABS' },
        { status: 409 },
      )
    }
    const uncounted = /uncounted_waiters:(\d+)/.exec(msg)
    if (uncounted) {
      return NextResponse.json(
        { error: `${uncounted[1]} server${uncounted[1] === '1' ? '' : 's'} not counted down yet.`, code: 'UNCOUNTED' },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  const { data: summary } = await supabase.rpc('get_night_dashboard', { p_shift_id: shift.id })
  const { data: waiters } = await supabase.rpc('get_waiter_cash_summary', { p_shift_id: shift.id })
  return NextResponse.json({ ok: true, summary, waiters })
}
