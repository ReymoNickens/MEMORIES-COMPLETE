import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const supabase = createSupabaseServiceRole()

  // Resolve token to venue table
  const { data: table } = await supabase
    .from('venue_tables')
    .select('id, tenant_id, label, zone, seats, min_spend_pesewas')
    .eq('qr_token', token)
    .eq('is_active', true)
    .single()

  if (!table) {
    return NextResponse.json({ error: 'Invalid QR token', code: 'NOT_FOUND' }, { status: 404 })
  }

  // Fetch available products for this zone
  const { data: products } = await supabase
    .from('products')
    .select('id, name, description, category, station, price_pesewas, image_url, section_access, sort_order')
    .eq('tenant_id', table.tenant_id)
    .eq('is_available', true)
    .order('category')
    .order('sort_order')

  // Filter by section_access
  const filteredProducts = (products ?? []).filter((p: { section_access: string[] | null; [key: string]: unknown }) => {
    if (!p.section_access || p.section_access.length === 0) return true
    return p.section_access.includes(table.zone as string)
  })

  return NextResponse.json({
    table: {
      id: table.id,
      label: table.label,
      zone: table.zone,
      seats: table.seats,
      min_spend_pesewas: table.min_spend_pesewas,
    },
    source: 'table_qr',
    allows_cash: true,
    products: filteredProducts,
  })
}
