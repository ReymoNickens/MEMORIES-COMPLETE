import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { requireContentAdmin } from '@/lib/admin-guard'

export const dynamic = 'force-dynamic'

// Same discipline as ticket-types: quantity_remaining is a live CAS counter
// consumed by the draw inside complete_paid_checkout. Raising
// quantity_available raises quantity_remaining by the same delta; it's
// never set directly, so an edit can't hand back a prize already awarded.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireContentAdmin()
  if ('error' in gate) return gate.error

  const body = await req.json().catch(() => null) as {
    name?: string
    description?: string
    active?: boolean
    quantity_available?: number
  } | null
  if (!body) return NextResponse.json({ error: 'bad body' }, { status: 400 })

  const supabase = createSupabaseServiceRole()

  const { data: existing } = await supabase.from('raffle_prizes')
    .select('id, tenant_id, quantity_available, quantity_remaining')
    .eq('id', params.id).eq('tenant_id', gate.staff.tenant_id).maybeSingle()
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const patch: Record<string, unknown> = {}
  if (body.name !== undefined) patch['name'] = body.name
  if (body.description !== undefined) patch['description'] = body.description
  if (body.active !== undefined) patch['active'] = body.active
  if (body.quantity_available !== undefined) {
    const awarded = existing.quantity_available - existing.quantity_remaining
    if (body.quantity_available < awarded) {
      return NextResponse.json({ error: `quantity_available cannot drop below ${awarded} already awarded` }, { status: 400 })
    }
    patch['quantity_available'] = body.quantity_available
    patch['quantity_remaining'] = body.quantity_available - awarded
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'no editable fields given' }, { status: 400 })
  }

  const { error } = await supabase.from('raffle_prizes').update(patch)
    .eq('id', params.id).eq('tenant_id', gate.staff.tenant_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
