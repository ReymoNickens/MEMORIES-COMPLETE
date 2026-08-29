import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { decryptSecret, sha256Hex } from '@evolveit/shared/crypto'
import { generateQrPayload } from '@evolveit/shared/totp'

function totpKey(): string {
  const k = process.env['TOTP_ENCRYPTION_KEY']
  if (!k || k.length !== 64) throw new Error('TOTP_ENCRYPTION_KEY must be a 64-char hex string')
  return k
}

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

  // Decrypt secret server-side and generate the current TOTP payload — never expose the secret
  let qr_payload: string | null = null
  try {
    const secret = decryptSecret(ticket.totp_secret_enc as string, totpKey())
    qr_payload = generateQrPayload(ticket.id, secret)
  } catch {
    // If decryption fails, return ticket info without a code; scanner will reject
  }

  // Tell the client how many seconds until the next 30-second window so it knows when to refresh
  const totp_expires_in = 30 - (Math.floor(Date.now() / 1000) % 30)

  return NextResponse.json({
    id: ticket.id,
    serial: ticket.serial,
    buyer_name: ticket.buyer_name,
    status: ticket.status,
    qr_payload,
    totp_expires_in,
    event_name: event.name,
    event_date: event.starts_at,
    ticket_type_name: type.name,
  })
}
