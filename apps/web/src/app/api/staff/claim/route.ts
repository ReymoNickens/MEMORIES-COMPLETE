import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { getStaffSession, staffCookieHeader } from '@/lib/staff-session'
import { stationKindsForRoles } from '@/lib/station-roles'

export async function POST(req: NextRequest) {
  const session = await getStaffSession()
  if (!session) return NextResponse.json({ error: 'Sign in first' }, { status: 401 })

  const body = await req.json().catch(() => null) as { station_kind?: string; station_label?: string } | null
  if (!body?.station_kind || !body.station_label) {
    return NextResponse.json({ error: 'Station required' }, { status: 400 })
  }

  // The actual authorization boundary — /api/staff/me only filters what the
  // UI offers, this is what stops a role from claiming a station it wasn't
  // offered, whether that's an honest client or a hand-crafted request.
  const allowed = stationKindsForRoles(session.roles)
  if (!allowed.includes(body.station_kind as (typeof allowed)[number])) {
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
