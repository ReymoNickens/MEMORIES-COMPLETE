import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { requireContentAdmin } from '@/lib/admin-guard'

export const dynamic = 'force-dynamic'

// Unlike GET /api/events (public, published-only), this lists every event —
// draft, published, cancelled — for the admin panel.
export async function GET() {
  const gate = await requireContentAdmin()
  if ('error' in gate) return gate.error

  const supabase = createSupabaseServiceRole()
  const { data, error } = await supabase
    .from('events')
    .select('id, name, host_name, artwork_url, starts_at, ends_at, status, venue_capacity')
    .eq('tenant_id', gate.staff.tenant_id)
    .order('starts_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ events: data ?? [] })
}

export async function POST(req: NextRequest) {
  const gate = await requireContentAdmin()
  if ('error' in gate) return gate.error

  const body = await req.json().catch(() => null) as {
    name?: string
    description?: string
    host_name?: string
    starts_at?: string
    ends_at?: string
    check_in_from?: string
    check_in_until?: string
    venue_capacity?: number
    status?: string
  } | null

  if (!body?.name || !body.host_name || !body.starts_at || !body.ends_at
    || !body.check_in_from || !body.check_in_until) {
    return NextResponse.json({ error: 'name, host_name, starts_at, ends_at, check_in_from and check_in_until are required' }, { status: 400 })
  }
  if (body.status && !['draft', 'published', 'cancelled'].includes(body.status)) {
    return NextResponse.json({ error: 'bad status' }, { status: 400 })
  }

  const supabase = createSupabaseServiceRole()
  const { data, error } = await supabase.from('events').insert({
    tenant_id: gate.staff.tenant_id,
    name: body.name,
    description: body.description ?? null,
    host_name: body.host_name,
    starts_at: body.starts_at,
    ends_at: body.ends_at,
    check_in_from: body.check_in_from,
    check_in_until: body.check_in_until,
    venue_capacity: body.venue_capacity ?? null,
    status: body.status ?? 'draft',
    created_by: gate.staff.user_id,
  }).select('id').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ id: data.id })
}
