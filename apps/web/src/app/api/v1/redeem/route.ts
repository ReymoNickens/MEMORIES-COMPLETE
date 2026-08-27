import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { parseQrPayload, verifyTotp } from '@evolveit/shared/totp'
import { decodeTotpSecret, hashDeviceKey } from '@evolveit/shared/crypto'
import { getStaffSession } from '@/lib/staff-session'
import type { RedeemResult } from '@evolveit/shared/types'

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServiceRole()
  const authHeader = req.headers.get('authorization') ?? ''
  const deviceKey = authHeader.replace('Bearer ', '').trim()
  const staff = await getStaffSession()

  let deviceId: string | null = null
  let deviceName = 'Door'
  let doorLabel = 'Door 1'

  if (deviceKey) {
    const { data: device } = await supabase
      .from('devices')
      .select('id, name, revoked_at')
      .eq('key_hash', hashDeviceKey(deviceKey))
      .maybeSingle()
    if (!device || device.revoked_at) {
      return NextResponse.json({ ok: false, reason: 'unauthorized' } satisfies RedeemResult, { status: 401 })
    }
    deviceId = device.id
    deviceName = device.name as string
  } else if (staff && (staff.roles.includes('door') || staff.roles.includes('owner') || staff.roles.includes('manager'))) {
    deviceName = staff.full_name
    doorLabel = staff.station_label ?? 'Door 1'
  } else {
    return NextResponse.json({ ok: false, reason: 'unauthorized' } satisfies RedeemResult, { status: 401 })
  }

  const body = await req.json().catch(() => null) as {
    ticket_id?: string
    totp_code?: string
    qr?: string
    door_label?: string
  } | null

  let ticketId = body?.ticket_id
  let totpCode = body?.totp_code

  if (body?.qr) {
    const parsed = parseQrPayload(body.qr)
    if (!parsed) return NextResponse.json({ ok: false, reason: 'invalid_code' } satisfies RedeemResult)
    ticketId = parsed.ticketId
    totpCode = parsed.totpCode
  }

  if (!ticketId || !totpCode) {
    return NextResponse.json({ ok: false, reason: 'not_found' } satisfies RedeemResult, { status: 400 })
  }

  if (body?.door_label) doorLabel = body.door_label

  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, totp_secret_enc, status')
    .eq('id', ticketId)
    .single()

  if (!ticket) return NextResponse.json({ ok: false, reason: 'not_found' } satisfies RedeemResult)

  const secret = decodeTotpSecret(ticket.totp_secret_enc as string)
  if (!verifyTotp(secret, totpCode, 1)) {
    return NextResponse.json({ ok: false, reason: 'invalid_code' } satisfies RedeemResult)
  }

  const { data: result } = await supabase.rpc('redeem_ticket', {
    p_ticket_id: ticketId,
    p_device_id: deviceId,
    p_device_name: deviceName,
    p_door_label: doorLabel,
    p_mode: 'online',
  })

  return NextResponse.json(result as RedeemResult)
}
