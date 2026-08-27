import { NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'

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
