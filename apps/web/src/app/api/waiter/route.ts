import { NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { getStaffSession } from '@/lib/staff-session'

/**
 * A server's own night: the tables they are running, what is still to come out
 * of the bar, and how much of the club's cash is currently in their apron.
 *
 * The waiter screen used to write `physical_amount_pesewas` straight into
 * `cash_collections` from the browser — the person being reconciled setting
 * their own reconciliation figure. Counting is now a manager action against
 * `shift_handovers`; a server sees what they owe and nothing more.
 */
export async function GET() {
  const staff = await getStaffSession()
  if (!staff) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const supabase = createSupabaseServiceRole()

  const { data: shift } = await supabase
    .from('shifts')
    .select('id')
    .eq('tenant_id', staff.tenant_id)
    .is('closed_at', null)
    .order('opened_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: tables } = await supabase
    .from('venue_tables')
    .select('id, label, zone, seats, min_spend_pesewas')
    .eq('tenant_id', staff.tenant_id)
    .eq('is_active', true)
    .order('zone', { ascending: false })
    .order('label')

  if (!shift) {
    return NextResponse.json({
      shift_id: null, no_shift: true, tables: tables ?? [],
      orders: [], cash: { owed_pesewas: 0, order_count: 0, counted: false },
    })
  }

  const { data: orders } = await supabase
    .from('orders')
    .select('id, venue_table_id, amount_pesewas, payment_source, status, created_at, paid_at, guest_name, order_items(id, product_name, quantity, status)')
    .eq('tenant_id', staff.tenant_id)
    .eq('shift_id', shift.id)
    .neq('status', 'voided')
    .order('created_at', { ascending: false })
    .limit(120)

  // Cash the club is owed by this server right now.
  const { data: cash } = await supabase
    .from('cash_collections')
    .select('amount_pesewas')
    .eq('shift_id', shift.id)
    .eq('attributed_waiter_id', staff.user_id)

  const { data: handover } = await supabase
    .from('shift_handovers')
    .select('physical_pesewas, counted_at')
    .eq('shift_id', shift.id)
    .eq('waiter_id', staff.user_id)
    .maybeSingle()

  const owed = (cash ?? []).reduce((s: number, r: { amount_pesewas: number }) => s + Number(r.amount_pesewas), 0)

  return NextResponse.json({
    shift_id: shift.id,
    no_shift: false,
    tables: tables ?? [],
    orders: orders ?? [],
    cash: {
      owed_pesewas: owed,
      order_count: (cash ?? []).length,
      counted: !!handover,
      counted_pesewas: handover ? Number(handover.physical_pesewas) : null,
    },
  })
}
