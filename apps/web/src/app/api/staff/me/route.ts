import { NextResponse } from 'next/server'
import { getStaffSession } from '@/lib/staff-session'
import { createSupabaseServiceRole } from '@/lib/supabase/server'

// Reads live data — ticket stock, menu availability, the signed-in session.
// Without this Next prerenders the handler at build time and serves whatever
// the database happened to hold when the image was built.
export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getStaffSession()
  if (!session) return NextResponse.json({ session: null }, { status: 401 })

  const supabase = createSupabaseServiceRole()
  const { data: stations } = await supabase
    .from('stations')
    .select('id, kind, label')
    .eq('tenant_id', session.tenant_id)
    .eq('is_active', true)
    .order('kind')

  return NextResponse.json({ session, stations: stations ?? [] })
}
