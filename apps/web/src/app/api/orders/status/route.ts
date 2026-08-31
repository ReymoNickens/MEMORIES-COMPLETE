import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { getStaffSession } from '@/lib/staff-session'

/**
 * Public order lookup by Paystack reference, for the guest confirmation page.
 *
 * Mirrors /api/tickets/status: a guest holds an unguessable reference from
 * their own callback URL, and that is the whole access control — the same
 * pattern used everywhere else a customer needs to check on their own money
 * without a login. Before this existed, orders/initiate sent every MoMo payer
 * to /checkout/return, which only ever looks up pending_checkouts — an F&B
 * order's reference lives on `orders`, so that lookup always came back empty
 * and a guest who had genuinely paid never found out.
 */
export async function GET(req: NextRequest) {
  const ref = req.nextUrl.searchParams.get('ref')
  if (!ref) return NextResponse.json({ confirmed: false, error: 'ref required' }, { status: 400 })

  const supabase = createSupabaseServiceRole()
  const { data: order } = await supabase
    .from('orders')
    .select('id, status, amount_pesewas, venue_tables(label)')
    .eq('paystack_ref', ref)
    .maybeSingle()

  if (!order) return NextResponse.json({ confirmed: false })

  const table = order.venue_tables as { label: string } | null
  const confirmed = ['paid', 'preparing', 'complete'].includes(order.status as string)

  return NextResponse.json({
    confirmed,
    order_id: order.id,
    status: order.status,
    amount_pesewas: order.amount_pesewas,
    table_label: table?.label ?? null,
  })
}

const FORWARD: Record<string, string[]> = {
  pending:   ['preparing', 'ready'],
  preparing: ['ready'],
  ready:     ['delivered'],
  delivered: [],
  voided:    [],
}

/**
 * Move one order line along the rail.
 *
 * Previously any signed-in staff member could set any item to any status,
 * including straight to `voided`. Voiding a paid line is how a drink leaves
 * the building without leaving a record, so it is now a manager action and it
 * writes a comp entry against the ledger rather than quietly vanishing.
 */
export async function POST(req: NextRequest) {
  const staff = await getStaffSession()
  if (!staff) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null) as {
    item_id?: string
    status?: string
    reason?: string
  } | null

  const next = body?.status ?? ''
  if (!body?.item_id || !['preparing', 'ready', 'delivered', 'voided'].includes(next)) {
    return NextResponse.json({ error: 'item_id and a valid status are required' }, { status: 400 })
  }

  const isManager = staff.roles.includes('owner') || staff.roles.includes('manager')
  if (next === 'voided' && !isManager) {
    return NextResponse.json(
      { error: 'Only a manager can void a line that has been paid for.' },
      { status: 403 },
    )
  }

  const supabase = createSupabaseServiceRole()
  const { data: item } = await supabase
    .from('order_items')
    .select('id, status, station, quantity, product_id, product_name, line_total_pesewas, orders(id, tenant_id, shift_id, status)')
    .eq('id', body.item_id)
    .maybeSingle()

  if (!item) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const order = item.orders as unknown as { id: string; tenant_id: string; shift_id: string | null; status: string }
  if (order.tenant_id !== staff.tenant_id) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  // The station that works a line is the station that may advance it.
  const station = item.station as string
  const worksThisStation =
    isManager ||
    (station === 'bar' && staff.roles.includes('bartender')) ||
    (station === 'kitchen' && staff.roles.includes('kitchen')) ||
    // A server carries the drink to the table, so a server marks it delivered.
    (next === 'delivered' && staff.roles.includes('waiter'))

  if (!worksThisStation) {
    return NextResponse.json({ error: `Your role does not work the ${station}.` }, { status: 403 })
  }

  // No jumping backwards, and no re-firing a line that is already out.
  const current = item.status as string
  if (next !== 'voided' && !(FORWARD[current] ?? []).includes(next)) {
    return NextResponse.json(
      { error: `Cannot move a ${current} line to ${next}.`, current },
      { status: 409 },
    )
  }

  const patch: Record<string, unknown> = { status: next }
  if (next === 'ready') patch.ready_at = new Date().toISOString()
  if (next === 'delivered') patch.delivered_at = new Date().toISOString()

  const { error } = await supabase.from('order_items').update(patch).eq('id', item.id).eq('status', current)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Voiding a line the guest already paid for does not move money — the club
  // keeps the cash — but it does move stock: a bottle left the shelf against
  // no served ticket. That belongs in stock_adjustments, which is what the
  // shortage report reads at close, not in the ledger. Posting it as revenue
  // would have inflated the night by the value of every comp.
  if (next === 'voided' && order.shift_id) {
    const amount = Number(item.line_total_pesewas)
    await supabase.from('stock_adjustments').insert({
      tenant_id: staff.tenant_id,
      shift_id: order.shift_id,
      product_id: item.product_id,
      kind: 'comp',
      qty: Number(item.quantity),
      amount_pesewas: amount > 0 ? amount : 0,
      note: `${item.quantity}x ${item.product_name} voided by ${staff.full_name}: ${body.reason ?? 'no reason given'}`,
      actor_id: staff.user_id,
    })
  }

  return NextResponse.json({ ok: true, status: next })
}
