import { NextResponse } from 'next/server'
import { getStaffSession } from '@/lib/staff-session'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { stationKindsForRoles } from '@/lib/station-roles'

// Reads live data — ticket stock, menu availability, the signed-in session.
// Without this Next prerenders the handler at build time and serves whatever
// the database happened to hold when the image was built.
export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getStaffSession()
  if (!session) return NextResponse.json({ session: null }, { status: 401 })

  const supabase = createSupabaseServiceRole()
  // Every station in the tenant used to come back regardless of the caller's
  // role, so the claim screen offered a bartender the door and a waiter the
  // kitchen — /api/staff/claim would have refused the claim, but only after
  // the UI let them try it. Filtered here so what's offered matches what's
  // actually authorized.
  const allowedKinds = stationKindsForRoles(session.roles)
  const { data: stations } = allowedKinds.length === 0
    ? { data: [] }
    : await supabase
        .from('stations')
        .select('id, kind, label')
        .eq('tenant_id', session.tenant_id)
        .eq('is_active', true)
        .in('kind', allowedKinds)
        .order('kind')

  return NextResponse.json({ session, stations: stations ?? [] })
}
