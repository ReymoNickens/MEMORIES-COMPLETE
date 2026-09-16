import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { getStaffSession } from '@/lib/staff-session'

export const dynamic = 'force-dynamic'

const STATUSES = ['open', 'waiter_cash', 'unaccounted_pour', 'explained', 'written_off'] as const

// Manager/owner only, both directions — a shortage is a finding about a
// named member of staff's shift, and deciding it's explained or written off
// is a financial call, not something the bar rail should be able to do to
// its own report.
export async function GET(req: NextRequest) {
  const staff = await getStaffSession()
  if (!staff || !staff.roles.some(r => ['manager', 'owner'].includes(r))) {
    return NextResponse.json({ error: 'forbidden' }, { status: staff ? 403 : 401 })
  }

  const supabase = createSupabaseServiceRole()
  const status = req.nextUrl.searchParams.get('status')

  let query = supabase
    .from('stock_shortages')
    .select('*, products(name), shifts(opened_at, closed_at)')
    .eq('tenant_id', staff.tenant_id)
    .order('created_at', { ascending: false })
  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ shortages: data ?? [] })
}

export async function PATCH(req: NextRequest) {
  const staff = await getStaffSession()
  if (!staff || !staff.roles.some(r => ['manager', 'owner'].includes(r))) {
    return NextResponse.json({ error: 'forbidden' }, { status: staff ? 403 : 401 })
  }

  const body = await req.json().catch(() => null) as {
    id?: string
    status?: string
    note?: string
    assigned_user?: string | null
  } | null

  if (!body?.id || !STATUSES.includes(body.status as (typeof STATUSES)[number])) {
    return NextResponse.json({ error: `id and status (${STATUSES.join('|')}) are required` }, { status: 400 })
  }

  const supabase = createSupabaseServiceRole()

  const patch: Record<string, unknown> = { status: body.status }
  if (body.note !== undefined) patch['note'] = body.note
  if (body.assigned_user !== undefined) patch['assigned_user'] = body.assigned_user

  const { error } = await supabase.from('stock_shortages').update(patch)
    .eq('id', body.id).eq('tenant_id', staff.tenant_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
