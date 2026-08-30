import { NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { getStaffSession } from '@/lib/staff-session'

// Reads live data — ticket stock, menu availability, the signed-in session.
// Without this Next prerenders the handler at build time and serves whatever
// the database happened to hold when the image was built.
export const dynamic = 'force-dynamic'

export async function GET() {
  const staff = await getStaffSession()
  if (!staff) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const supabase = createSupabaseServiceRole()
  const { data } = await supabase
    .from('venue_tables')
    .select('id, label, zone, seats, min_spend_pesewas, qr_token, is_active')
    .eq('tenant_id', staff.tenant_id)
    .eq('is_active', true)
    .order('label')
  return NextResponse.json({ tables: data ?? [] })
}
