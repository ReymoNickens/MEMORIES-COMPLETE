import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const ref = req.nextUrl.searchParams.get('ref')
  if (!ref) return NextResponse.json({ issued: false })

  const supabase = createSupabaseServiceRole()
  const { data: checkout } = await supabase
    .from('pending_checkouts')
    .select('id, status')
    .eq('paystack_ref', ref)
    .single()

  if (!checkout) return NextResponse.json({ issued: false })
  if (checkout.status === 'failed') return NextResponse.json({ issued: false, failed: true })
  if (checkout.status !== 'issued') return NextResponse.json({ issued: false })

  const { data: payments } = await supabase
    .from('ticket_payments')
    .select('ticket_id')
    .like('paystack_ref', `${ref}%`)

  return NextResponse.json({
    issued: true,
    ticket_ids: (payments ?? []).map((p: { ticket_id: string }) => p.ticket_id),
  })
}
