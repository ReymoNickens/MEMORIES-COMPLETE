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
    ticket_type_id?: string | null
    redemption_type?: string
    win_mode?: string
    win_probability?: number | null
    quantity_available?: number
    ledger_account?: string | null
    cost_pesewas?: number
  } | null

  if (!body?.name || !body.redemption_type || !body.win_mode || !body.quantity_available) {
    return NextResponse.json({ error: 'name, redemption_type, win_mode and quantity_available are required' }, { status: 400 })
  }
  if (!['free_item', 'upgrade', 'digital_only'].includes(body.redemption_type)) {
    return NextResponse.json({ error: 'bad redemption_type' }, { status: 400 })
  }
  if (!['fixed_count', 'probability'].includes(body.win_mode)) {
    return NextResponse.json({ error: 'bad win_mode' }, { status: 400 })
  }
  if (body.win_mode === 'probability' && (body.win_probability == null || body.win_probability < 0 || body.win_probability > 1)) {
    return NextResponse.json({ error: 'win_probability (0-1) is required for probability mode' }, { status: 400 })
  }
  if (body.quantity_available < 1) {
    return NextResponse.json({ error: 'quantity_available must be >= 1' }, { status: 400 })
  }
  const cost = body.cost_pesewas ?? 0
  if (cost > 0 && !body.ledger_account) {
    return NextResponse.json({ error: 'ledger_account is required when cost_pesewas > 0' }, { status: 400 })
  }

  const supabase = createSupabaseServiceRole()

  const { data: event } = await supabase.from('events')
    .select('id').eq('id', params.id).eq('tenant_id', gate.staff.tenant_id).maybeSingle()
  if (!event) return NextResponse.json({ error: 'event not found' }, { status: 404 })

  const { data, error } = await supabase.from('raffle_prizes').insert({
    event_id: params.id,
    tenant_id: gate.staff.tenant_id,
    ticket_type_id: body.ticket_type_id ?? null,
    name: body.name,
    description: body.description ?? null,
    redemption_type: body.redemption_type,
    win_mode: body.win_mode,
    win_probability: body.win_mode === 'probability' ? body.win_probability : null,
    quantity_available: body.quantity_available,
    quantity_remaining: body.quantity_available,
    ledger_account: cost > 0 ? body.ledger_account : null,
    cost_pesewas: cost,
    created_by: gate.staff.user_id,
  }).select('id').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ id: data.id })
}
