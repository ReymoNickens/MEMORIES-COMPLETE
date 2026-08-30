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
    .from('products')
    .select('id, name, category, station, price_pesewas')
    .eq('tenant_id', staff.tenant_id)
    .eq('is_available', true)
    .order('station')
    .order('name')
  return NextResponse.json({ products: data ?? [] })
}
