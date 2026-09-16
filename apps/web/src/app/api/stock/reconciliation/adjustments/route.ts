import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { getStaffSession } from '@/lib/staff-session'

const CAN_LOG = ['bartender', 'manager', 'owner'] as const
const KINDS = ['comp', 'debt', 'breakage', 'transfer'] as const

// Stock that left the shelf without a matching sale — a comp, breakage, a
// tab run on trust, or a transfer to another station. Logged here so
// reconciliation counts it as accounted for instead of flagging it as a
// leak; the one that already existed (a voided order item) still writes
// here the same way, this just gives bar staff a way to log the rest.
export async function POST(req: NextRequest) {
  const staff = await getStaffSession()
  if (!staff || !staff.roles.some(r => (CAN_LOG as readonly string[]).includes(r))) {
    return NextResponse.json({ error: 'forbidden' }, { status: staff ? 403 : 401 })
  }

  const body = await req.json().catch(() => null) as {
    shift_id?: string
    product_id?: string
    kind?: string
    qty?: number
    amount_pesewas?: number
    guest_name?: string
    note?: string
  } | null

  if (!body?.shift_id || !body.product_id || !KINDS.includes(body.kind as (typeof KINDS)[number])
    || !body.qty || body.qty < 1) {
    return NextResponse.json({ error: `shift_id, product_id, kind (${KINDS.join('|')}) and qty (>= 1) are required` }, { status: 400 })
  }

  const supabase = createSupabaseServiceRole()

  const { data: shift } = await supabase.from('shifts').select('id').eq('id', body.shift_id).eq('tenant_id', staff.tenant_id).maybeSingle()
  if (!shift) return NextResponse.json({ error: 'shift not found' }, { status: 404 })

  const { error } = await supabase.from('stock_adjustments').insert({
    tenant_id: staff.tenant_id,
    shift_id: body.shift_id,
    product_id: body.product_id,
    kind: body.kind,
    qty: body.qty,
    amount_pesewas: Math.max(0, body.amount_pesewas ?? 0),
    guest_name: body.guest_name || null,
    note: body.note || null,
    actor_id: staff.user_id,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
