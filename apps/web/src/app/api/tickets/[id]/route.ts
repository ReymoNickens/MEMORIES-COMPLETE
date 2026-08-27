import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { decodeTotpSecret, sha256Hex } from '@evolveit/shared/crypto'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const access = req.nextUrl.searchParams.get('access')
  if (!access) return NextResponse.json({ error: 'access token required' }, { status: 401 })

  const supabase = createSupabaseServiceRole()
  const { data: grant } = await supabase
    .from('ticket_access')
    .select('ticket_id')
    .eq('ticket_id', params.id)
    .eq('token_hash', sha256Hex(access))
    .single()

  if (!grant) return NextResponse.json({ error: 'invalid access' }, { status: 401 })

  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, serial, buyer_name, status, totp_secret_enc, ticket_types(name), events(name, starts_at)')
    .eq('id', params.id)
    .single()

  if (!ticket) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const event = ticket.events as { name: string; starts_at: string }
  const type = ticket.ticket_types as { name: string }

  return NextResponse.json({
    id: ticket.id,
    serial: ticket.serial,
    buyer_name: ticket.buyer_name,
    status: ticket.status,
    totp_secret: decodeTotpSecret(ticket.totp_secret_enc as string),
    event_name: event.name,
    event_date: event.starts_at,
    ticket_type_name: type.name,
  })
}
