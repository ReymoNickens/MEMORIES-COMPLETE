import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { getStaffSession, staffCookieHeader } from '@/lib/staff-session'

const ROLE_STATIONS: Record<string, string[]> = {
  owner: ['door', 'bar', 'kitchen', 'floor', 'cashier'],
  manager: ['door', 'bar', 'kitchen', 'floor', 'cashier'],
  door: ['door'],
  bartender: ['bar'],
  kitchen: ['kitchen'],
  waiter: ['floor'],
  cashier: ['cashier'],
  organiser: [],
}

export async function POST(req: NextRequest) {
  const session = await getStaffSession()
  if (!session) return NextResponse.json({ error: 'Sign in first' }, { status: 401 })

  const body = await req.json().catch(() => null) as { station_kind?: string; station_label?: string } | null
  if (!body?.station_kind || !body.station_label) {
    return NextResponse.json({ error: 'Station required' }, { status: 400 })
  }

  const allowed = session.roles.flatMap(r => ROLE_STATIONS[r] ?? [])
  if (!allowed.includes(body.station_kind) && !session.roles.includes('owner') && !session.roles.includes('manager')) {
    return NextResponse.json({ error: 'Role cannot claim that station' }, { status: 403 })
  }

  const supabase = createSupabaseServiceRole()
  await supabase
    .from('station_sessions')
    .update({ released_at: new Date().toISOString() })
    .eq('user_id', session.user_id)
    .is('released_at', null)

  const { error } = await supabase.from('station_sessions').insert({
    tenant_id: session.tenant_id,
    user_id: session.user_id,
    role: session.roles[0],
    station_kind: body.station_kind,
    station_label: body.station_label,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const next = { ...session, station_kind: body.station_kind, station_label: body.station_label }
  const res = NextResponse.json({ ok: true, session: next })
  res.headers.append('Set-Cookie', staffCookieHeader(next))
  return res
}
