import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { getStaffSession } from '@/lib/staff-session'
import { encodeTotpSecret, randomToken, sha256Hex } from '@evolveit/shared/crypto'
import * as OTPAuth from 'otpauth'

export async function POST(req: NextRequest) {
  const staff = await getStaffSession()
  if (!staff || !(staff.roles.includes('owner') || staff.roles.includes('manager') || staff.roles.includes('door'))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => null) as { ticket_id?: string; reason?: string } | null
  if (!body?.ticket_id || !['reissue_lost', 'reissue_stolen', 'admin'].includes(body.reason ?? '')) {
    return NextResponse.json({ error: 'ticket_id and reason required' }, { status: 400 })
  }

  const supabase = createSupabaseServiceRole()
  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, tenant_id, reissue_count, status, buyer_phone')
    .eq('id', body.ticket_id)
    .single()

  if (!ticket) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (ticket.status === 'voided' || ticket.status === 'used') {
    return NextResponse.json({ error: `cannot reissue ${ticket.status}` }, { status: 409 })
  }
  if ((ticket.reissue_count as number) >= 2) {
    return NextResponse.json({ error: 'reissue limit reached' }, { status: 409 })
  }

  const secret = new OTPAuth.Secret({ size: 20 }).base32
  const access = randomToken(18)

  await supabase.from('tickets').update({
    totp_secret_enc: encodeTotpSecret(secret),
    reissue_count: (ticket.reissue_count as number) + 1,
  }).eq('id', ticket.id)

  await supabase.from('ticket_access').upsert({
    ticket_id: ticket.id,
    token_hash: sha256Hex(access),
  })

  await supabase.from('ownership_history').insert({
    ticket_id: ticket.id,
    from_phone: ticket.buyer_phone,
    to_phone: ticket.buyer_phone,
    reason: body.reason,
    performed_by: staff.user_id,
  })

  return NextResponse.json({ ok: true, ticket_id: ticket.id, access_token: access })
}
