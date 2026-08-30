import { NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'

// Reads live data — ticket stock, menu availability, the signed-in session.
// Without this Next prerenders the handler at build time and serves whatever
// the database happened to hold when the image was built.
export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = createSupabaseServiceRole()
  const { data, error } = await supabase
    .from('events')
    .select('id, name, description, host_name, starts_at, ends_at, artwork_url, status, ticket_types(id, name, price_pesewas, remaining, total, allow_installments, sale_starts_at, sale_ends_at)')
    .eq('status', 'published')
    .order('starts_at')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ events: data ?? [] })
}
