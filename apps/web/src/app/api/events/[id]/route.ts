import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServiceRole()
  const { data, error } = await supabase
    .from('events')
    .select('id, name, description, host_name, starts_at, ends_at, artwork_url, status, check_in_from, check_in_until, ticket_types(id, name, description, price_pesewas, remaining, total, allow_installments, sale_starts_at, sale_ends_at)')
    .eq('id', params.id)
    .eq('status', 'published')
    .single()

  if (error || !data) return NextResponse.json({ error: 'Event not found' }, { status: 404 })
  return NextResponse.json({ event: data })
}
