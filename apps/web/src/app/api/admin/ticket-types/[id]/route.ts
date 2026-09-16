import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { requireContentAdmin } from '@/lib/admin-guard'

export const dynamic = 'force-dynamic'

// `remaining` is never set directly here — it's the live CAS stock counter
// complete_paid_checkout decrements under lock. Raising `total` (adding more
// stock to sell) raises `remaining` by the same delta instead of touching it
// directly, so an admin edit can never hand back seats that were already
// sold or desync the two columns.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
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
  if (!body) return NextResponse.json({ error: 'bad body' }, { status: 400 })

  const supabase = createSupabaseServiceRole()

  const { data: existing } = await supabase.from('ticket_types')
    .select('id, tenant_id, total, remaining')
    .eq('id', params.id).eq('tenant_id', gate.staff.tenant_id).maybeSingle()
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const patch: Record<string, unknown> = {}
  if (body.name !== undefined) patch['name'] = body.name
  if (body.description !== undefined) patch['description'] = body.description
  if (body.price_pesewas !== undefined) {
    if (body.price_pesewas < 0) return NextResponse.json({ error: 'price_pesewas must be >= 0' }, { status: 400 })
    patch['price_pesewas'] = body.price_pesewas
  }
  if (body.sale_starts_at !== undefined) patch['sale_starts_at'] = body.sale_starts_at
  if (body.sale_ends_at !== undefined) patch['sale_ends_at'] = body.sale_ends_at
  if (body.allow_installments !== undefined) patch['allow_installments'] = body.allow_installments
  if (body.total !== undefined) {
    const sold = existing.total - existing.remaining
    if (body.total < sold) {
      return NextResponse.json({ error: `total cannot drop below ${sold} tickets already sold` }, { status: 400 })
    }
    patch['total'] = body.total
    patch['remaining'] = body.total - sold
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'no editable fields given' }, { status: 400 })
  }

  const { error } = await supabase.from('ticket_types').update(patch)
    .eq('id', params.id).eq('tenant_id', gate.staff.tenant_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
