import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { requireContentAdmin } from '@/lib/admin-guard'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireContentAdmin()
  if ('error' in gate) return gate.error

  const body = await req.json().catch(() => null) as {
    name?: string
    description?: string
    price_pesewas?: number
    total?: number
    sale_starts_at?: string
    sale_ends_at?: string
    allow_installments?: boolean
  } | null

  if (!body?.name || body.price_pesewas == null || !body.total
    || !body.sale_starts_at || !body.sale_ends_at) {
    return NextResponse.json({ error: 'name, price_pesewas, total, sale_starts_at and sale_ends_at are required' }, { status: 400 })
  }
  if (body.price_pesewas < 0 || body.total < 1) {
    return NextResponse.json({ error: 'price_pesewas must be >= 0 and total >= 1' }, { status: 400 })
  }

  const supabase = createSupabaseServiceRole()

  const { data: event } = await supabase.from('events')
    .select('id').eq('id', params.id).eq('tenant_id', gate.staff.tenant_id).maybeSingle()
  if (!event) return NextResponse.json({ error: 'event not found' }, { status: 404 })

  const { data, error } = await supabase.from('ticket_types').insert({
    event_id: params.id,
    tenant_id: gate.staff.tenant_id,
    name: body.name,
    description: body.description ?? null,
    price_pesewas: body.price_pesewas,
    remaining: body.total,
    total: body.total,
    sale_starts_at: body.sale_starts_at,
    sale_ends_at: body.sale_ends_at,
    allow_installments: body.allow_installments ?? false,
  }).select('id').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ id: data.id })
}
