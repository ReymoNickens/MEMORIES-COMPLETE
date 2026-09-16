import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { getStaffSession } from '@/lib/staff-session'

export const dynamic = 'force-dynamic'

const CAN_VIEW = ['bartender', 'manager', 'owner'] as const

// The bar stock sheet — every bar product for a shift, with opening/closing
// counts where entered, what the till says was sold, logged adjustments
// (comps/breakage/debt/transfer), and the resulting shortage if any. This is
// a different reconciliation from cash: a bartender who under-rings a round
// and pockets the difference balances their cash perfectly, so this is what
// actually catches that.
export async function GET(req: NextRequest) {
  const staff = await getStaffSession()
  if (!staff || !staff.roles.some(r => (CAN_VIEW as readonly string[]).includes(r))) {
    return NextResponse.json({ error: 'forbidden' }, { status: staff ? 403 : 401 })
  }

  const supabase = createSupabaseServiceRole()

  let shiftId = req.nextUrl.searchParams.get('shift_id')
  if (!shiftId) {
    const { data: shift } = await supabase
      .from('shifts')
      .select('id')
      .eq('tenant_id', staff.tenant_id)
      .is('closed_at', null)
      .order('opened_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    shiftId = shift?.id ?? null
  }

  if (!shiftId) {
    return NextResponse.json({ shift_id: null, rows: [] })
  }

  // Scope check: the shift belongs to this tenant before running anything
  // against it, whether it came from the query string or the open-shift
  // lookup above.
  const { data: shift } = await supabase.from('shifts').select('id').eq('id', shiftId).eq('tenant_id', staff.tenant_id).maybeSingle()
  if (!shift) return NextResponse.json({ error: 'shift not found' }, { status: 404 })

  const { data: rows, error } = await supabase.rpc('get_stock_reconciliation', { p_shift_id: shiftId })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: shortages } = await supabase
    .from('stock_shortages')
    .select('product_id, status, note')
    .eq('shift_id', shiftId) as { data: Array<{ product_id: string; status: string; note: string | null }> | null }

  const shortageByProduct = new Map((shortages ?? []).map(s => [s.product_id, s]))

  return NextResponse.json({
    shift_id: shiftId,
    rows: (rows ?? []).map((r: Record<string, unknown>) => ({
      ...r,
      shortage_status: shortageByProduct.get(r['product_id'] as string)?.status ?? null,
      shortage_note: shortageByProduct.get(r['product_id'] as string)?.note ?? null,
    })),
  })
}
