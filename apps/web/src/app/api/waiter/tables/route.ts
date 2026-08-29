import { NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { getStaffSession } from '@/lib/staff-session'

export async function GET() {
  const staff = await getStaffSession()
  if (!staff) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const supabase = createSupabaseServiceRole()

  // Fetch tables where this waiter has at least one active order
  const { data: orders } = await supabase
    .from('orders')
    .select(`
      id, amount_pesewas, payment_source, status, created_at, venue_table_id,
      order_items(product_name, quantity, status)
    `)
    .eq('tenant_id', staff.tenant_id)
    .eq('waiter_id', staff.user_id)
    .not('status', 'in', '("voided","complete")')
    .order('created_at')

  // Group by table_id
  const tableMap = new Map<string, { table_id: string; orders: typeof orders }>()
  for (const o of orders ?? []) {
    const tid = o.venue_table_id as string | null ?? '__no_table__'
    if (!tableMap.has(tid)) tableMap.set(tid, { table_id: tid, orders: [] })
    tableMap.get(tid)!.orders!.push(o)
  }

  // Fetch table labels for the matched table ids
  const tableIds = [...tableMap.keys()].filter(id => id !== '__no_table__')
  const { data: tables } = tableIds.length > 0
    ? await supabase.from('venue_tables').select('id, label, zone').in('id', tableIds)
    : { data: [] }

  const tableLabels = Object.fromEntries((tables ?? []).map((t: { id: string; label: string; zone: string | null }) => [t.id, { label: t.label, zone: t.zone }]))

  const result = [...tableMap.entries()].map(([tid, { orders: tableOrders }]) => ({
    id: tid,
    label: tableLabels[tid]?.label ?? '—',
    zone: tableLabels[tid]?.zone ?? null,
    orders: tableOrders ?? [],
  }))

  return NextResponse.json({ tables: result })
}
