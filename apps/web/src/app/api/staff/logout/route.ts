import { NextResponse } from 'next/server'
import { clearStaffCookieHeader, getStaffSession } from '@/lib/staff-session'
import { createSupabaseServiceRole } from '@/lib/supabase/server'

export async function POST() {
  const session = await getStaffSession()
  if (session) {
    const supabase = createSupabaseServiceRole()
    await supabase
      .from('station_sessions')
      .update({ released_at: new Date().toISOString() })
      .eq('user_id', session.user_id)
      .is('released_at', null)
  }
  const res = NextResponse.json({ ok: true })
  res.headers.append('Set-Cookie', clearStaffCookieHeader())
  return res
}
