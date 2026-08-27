import { NextResponse } from 'next/server'
import { getStaffSession } from '@/lib/staff-session'
import { createSupabaseServiceRole } from '@/lib/supabase/server'

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
