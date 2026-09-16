import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { getStaffSession } from '@/lib/staff-session'

const CAN_COUNT = ['bartender', 'manager', 'owner'] as const

export async function POST(req: NextRequest) {
  const staff = await getStaffSession()
  if (!staff || !staff.roles.some(r => (CAN_COUNT as readonly string[]).includes(r))) {
    return NextResponse.json({ error: 'forbidden' }, { status: staff ? 403 : 401 })
  }

  const body = await req.json().catch(() => null) as {
    shift_id?: string
    product_id?: string
    kind?: 'opening' | 'closing'
    qty?: number
  } | null

  if (!body?.shift_id || !body.product_id || !['opening', 'closing'].includes(body.kind ?? '')
    || body.qty == null || body.qty < 0) {
    return NextResponse.json({ error: 'shift_id, product_id, kind (opening|closing) and qty (>= 0) are required' }, { status: 400 })
  }

  const supabase = createSupabaseServiceRole()

  const { data: shift } = await supabase.from('shifts').select('id').eq('id', body.shift_id).eq('tenant_id', staff.tenant_id).maybeSingle()
  if (!shift) return NextResponse.json({ error: 'shift not found' }, { status: 404 })

  const table = body.kind === 'opening' ? 'stock_openings' : 'stock_closings'
  const { error } = await supabase.from(table).upsert({
    shift_id: body.shift_id,
    product_id: body.product_id,
    qty: body.qty,
    set_by: staff.user_id,
    set_at: new Date().toISOString(),
  }, { onConflict: 'shift_id,product_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
