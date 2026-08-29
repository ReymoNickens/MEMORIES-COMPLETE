import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { getStaffSession } from '@/lib/staff-session'

export async function POST(req: NextRequest) {
  const staff = await getStaffSession()
  if (!staff) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null) as { item_id?: string; status?: string } | null
  const allowed = ['preparing', 'ready', 'delivered', 'voided']
  if (!body?.item_id || !allowed.includes(body.status ?? '')) {
    return NextResponse.json({ error: 'item_id and status required' }, { status: 400 })
  }

  const supabase = createSupabaseServiceRole()
  const patch: Record<string, unknown> = { status: body.status }
  if (body.status === 'ready') patch.ready_at = new Date().toISOString()
  if (body.status === 'delivered') patch.delivered_at = new Date().toISOString()

  // Join through orders to enforce tenant isolation — prevents cross-tenant item manipulation
  const { data: item } = await supabase
    .from('order_items')
    .select('id, order_id, orders!inner(tenant_id)')
    .eq('id', body.item_id)
    .eq('orders.tenant_id', staff.tenant_id)
    .single()

  if (!item) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const { error } = await supabase.from('order_items').update(patch).eq('id', body.item_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
