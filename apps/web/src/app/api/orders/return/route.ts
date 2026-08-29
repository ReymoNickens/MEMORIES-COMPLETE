import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const ref = req.nextUrl.searchParams.get('ref')
  if (!ref) return NextResponse.json({ confirmed: false, error: 'ref required' }, { status: 400 })

  const supabase = createSupabaseServiceRole()
  const { data: order } = await supabase
    .from('orders')
    .select('id, status, table_id, venue_tables(label)')
    .eq('paystack_ref', ref)
    .maybeSingle()

  if (!order) return NextResponse.json({ confirmed: false })

  const confirmed = order.status === 'paid' || order.status === 'preparing' || order.status === 'ready'
  const table = order.venue_tables as { label: string } | null

  return NextResponse.json({
    confirmed,
    order_id: order.id,
    status: order.status,
    table_label: table?.label ?? null,
  })
}
