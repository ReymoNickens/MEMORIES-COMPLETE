import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { decodeTotpSecret, sha256Hex } from '@evolveit/shared/crypto'
import { generateQrPayload } from '@evolveit/shared/totp'

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
    .select('id, totp_secret_enc, status')
    .eq('id', params.id)
    .single()

  if (!ticket) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (ticket.status !== 'issued') {
    return NextResponse.json({ error: ticket.status }, { status: 409 })
  }

  const secret = decodeTotpSecret(ticket.totp_secret_enc as string)
  const payload = generateQrPayload(ticket.id, secret)
  const secondsLeft = 30 - (Math.floor(Date.now() / 1000) % 30)

  return NextResponse.json({
    payload,
    seconds_left: secondsLeft === 0 ? 30 : secondsLeft,
  })
}
