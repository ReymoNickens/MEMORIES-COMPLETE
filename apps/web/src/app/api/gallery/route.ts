import { NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// Public read for the site's gallery, same shape as GET /api/events: the
// anon key never queries Supabase directly, so even a public listing goes
// through a route holding the service role.
export async function GET() {
  const supabase = createSupabaseServiceRole()
  const { data, error } = await supabase.from('gallery_photos')
    .select('id, url, caption').order('sort_order')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ photos: data ?? [] })
}
