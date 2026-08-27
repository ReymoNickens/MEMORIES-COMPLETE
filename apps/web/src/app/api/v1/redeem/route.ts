import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { parseQrPayload, verifyTotp } from '@evolveit/shared/totp'
import type { RedeemRequest, RedeemResult } from '@evolveit/shared/types'

export async function POST(req: NextRequest) {
  // Auth: device API key in Authorization header
  const authHeader = req.headers.get('authorization') ?? ''
  const deviceKey = authHeader.replace('Bearer ', '').trim()

  if (!deviceKey) {
    return NextResponse.json({ ok: false, reason: 'unauthorized' } satisfies RedeemResult, { status: 401 })
  }

  const supabase = createSupabaseServiceRole()

  // Verify device key hash
  const { data: device } = await supabase
    .from('devices')
    .select('id, name, role, revoked_at, event_ids')
    .filter('key_hash', 'eq', hashDeviceKey(deviceKey))
    .single()

  if (!device || device.revoked_at) {
    return NextResponse.json({ ok: false, reason: 'unauthorized' } satisfies RedeemResult, { status: 401 })
  }

  let body: RedeemRequest
  try {
    body = await req.json() as RedeemRequest
  } catch {
    return NextResponse.json({ ok: false, reason: 'not_found' } satisfies RedeemResult, { status: 400 })
  }

  const { ticket_id, totp_code, door_label } = body

  // Fetch ticket TOTP secret (never log it)
  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, totp_secret_enc, status')
    .eq('id', ticket_id)
    .single()

  if (!ticket) {
    return NextResponse.json<RedeemResult>({ ok: false, reason: 'not_found' })
  }

  // Verify TOTP before calling redeem
  const decryptedSecret = decryptSecret(ticket.totp_secret_enc as string)
  const totpValid = verifyTotp(decryptedSecret, totp_code, 1)

  if (!totpValid) {
    return NextResponse.json<RedeemResult>({ ok: false, reason: 'invalid_code' })
  }

  // Call the atomic redeem Postgres function
  const { data: result } = await supabase.rpc('redeem_ticket', {
    p_ticket_id: ticket_id,
    p_device_id: device.id,
    p_device_name: device.name as string,
    p_door_label: door_label,
    p_mode: 'online',
  })

  return NextResponse.json(result as RedeemResult)
}

function hashDeviceKey(key: string): string {
  // In production: use argon2id
  // Placeholder: SHA-256 for type safety
  const { createHash } = require('crypto') as typeof import('crypto')
  return createHash('sha256').update(key).digest('hex')
}

function decryptSecret(enc: string): string {
  // In production: decrypt with AES-GCM tenant key
  return Buffer.from(enc, 'base64').toString('utf8')
}
