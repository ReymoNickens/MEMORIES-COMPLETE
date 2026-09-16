import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { requireContentAdmin } from '@/lib/admin-guard'

export const dynamic = 'force-dynamic'

const EDITABLE_FIELDS = [
  'name', 'description', 'host_name', 'artwork_url',
  'starts_at', 'ends_at', 'check_in_from', 'check_in_until',
  'venue_capacity', 'status',
] as const

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireContentAdmin()
  if ('error' in gate) return gate.error

  const supabase = createSupabaseServiceRole()
  const { data, error } = await supabase
    .from('events')
    .select('*, ticket_types(*), raffle_prizes(*)')
    .eq('id', params.id)
    .eq('tenant_id', gate.staff.tenant_id)
    .single()

  if (error || !data) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ event: data })
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireContentAdmin()
  if ('error' in gate) return gate.error

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'bad body' }, { status: 400 })

  const patch: Record<string, unknown> = {}
  for (const field of EDITABLE_FIELDS) {
    if (field in body) patch[field] = body[field]
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'no editable fields given' }, { status: 400 })
  }
  if (patch['status'] && !['draft', 'published', 'cancelled'].includes(patch['status'] as string)) {
    return NextResponse.json({ error: 'bad status' }, { status: 400 })
  }

  const supabase = createSupabaseServiceRole()
  const { error } = await supabase.from('events').update(patch)
    .eq('id', params.id).eq('tenant_id', gate.staff.tenant_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
