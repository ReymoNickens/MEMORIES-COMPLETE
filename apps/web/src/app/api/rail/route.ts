import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { getStaffSession } from '@/lib/staff-session'

/**
 * The bar and kitchen rail for one station, scoped to the open shift.
 *
 * The bar display used to query `orders` straight from the browser with the
 * anon key, filtered only on `status = 'paid'` — so once orders started being
 * closed it would have shown every paid order the club had ever taken, and
 * under RLS it showed nothing at all. Scoped here to the current shift and to
 * the station the signed-in staff member has actually claimed.
 */
export async function GET(req: NextRequest) {
  const staff = await getStaffSession()
  if (!staff) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const supabase = createSupabaseServiceRole()

  // The claimed station wins; a query param can only narrow within the tenant.
  const requested = req.nextUrl.searchParams.get('station')
  const station = staff.station_label ?? requested
  const kind = req.nextUrl.searchParams.get('kind') === 'kitchen' ? 'kitchen' : 'bar'

  const { data: shift } = await supabase
    .from('shifts')
    .select('id')
    .eq('tenant_id', staff.tenant_id)
    .is('closed_at', null)
    .order('opened_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!shift) {
    return NextResponse.json({ station, shift_id: null, orders: [], no_shift: true })
  }

  let query = supabase
    .from('orders')
    .select('id, created_at, paid_at, station_label, guest_name, venue_tables(label), order_items(id, product_name, quantity, status, station)')
    .eq('tenant_id', staff.tenant_id)
    .eq('shift_id', shift.id)
    .in('status', ['paid', 'preparing'])
    .order('paid_at', { ascending: true, nullsFirst: false })
    .limit(80)

  // The kitchen works the whole venue; a bar works only its own counter.
  if (kind === 'bar' && station) query = query.eq('station_label', station)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  type Row = {
    id: string
    created_at: string
    paid_at: string | null
    station_label: string | null
    guest_name: string
    venue_tables: { label: string } | null
    order_items: Array<{ id: string; product_name: string; quantity: number; status: string; station: string }>
  }

  const orders = ((data ?? []) as unknown as Row[])
    .map(o => ({
      id: o.id,
      // The last four of the uuid, which is what the guest is told to say.
      token: o.id.slice(-4).toUpperCase(),
      // Age from payment, not creation: an order is not the bar's problem
      // until the money has landed.
      since: o.paid_at ?? o.created_at,
      guest_name: o.guest_name,
      table_label: o.venue_tables?.label ?? null,
      station_label: o.station_label,
      items: o.order_items.filter(i => i.station === kind && i.status !== 'voided'),
    }))
    .filter(o => o.items.length > 0)
    .filter(o => o.items.some(i => i.status !== 'delivered'))

  return NextResponse.json({ station, kind, shift_id: shift.id, orders })
}
