import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import type { TicketStatusResponse } from '@evolveit/shared/types'

export async function GET(req: NextRequest) {
  const ref = req.nextUrl.searchParams.get('ref')
  if (!ref) {
    return NextResponse.json({ error: 'Missing ref', code: 'NOT_FOUND' }, { status: 400 })
  }

  const supabase = createSupabaseServiceRole()

  const { data: payment } = await supabase
    .from('ticket_payments')
    .select('status, ticket_id')
    .eq('paystack_ref', ref)
    .single()

  if (!payment) {
    return NextResponse.json<TicketStatusResponse>({ issued: false })
  }

  if (payment.status === 'failed') {
    return NextResponse.json<TicketStatusResponse>({ issued: false, failed: true })
  }

  if (payment.status === 'successful') {
    // Find the actual ticket by payment ref via the ticket record
    const { data: ticket } = await supabase
      .from('tickets')
      .select('id')
      .eq('buyer_email', '') // placeholder — in production link via metadata
      .eq('status', 'issued')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    return NextResponse.json<TicketStatusResponse>({
      issued: true,
      ticket_id: ticket?.id,
    })
  }

  // Still pending
  return NextResponse.json<TicketStatusResponse>({ issued: false })
}
