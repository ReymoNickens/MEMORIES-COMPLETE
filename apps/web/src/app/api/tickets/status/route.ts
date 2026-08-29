import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { decryptSecret } from '@evolveit/shared/crypto'

function totpKey(): string {
  const k = process.env['TOTP_ENCRYPTION_KEY']
  if (!k || k.length !== 64) throw new Error('TOTP_ENCRYPTION_KEY must be a 64-char hex string')
  return k
}

export async function GET(req: NextRequest) {
  const ref = req.nextUrl.searchParams.get('ref')
  if (!ref) return NextResponse.json({ issued: false })

  const supabase = createSupabaseServiceRole()
  const { data: checkout } = await supabase
    .from('pending_checkouts')
    .select('id, status, access_tokens')
    .eq('paystack_ref', ref)
    .single()

  if (!checkout) return NextResponse.json({ issued: false })
  if (checkout.status === 'failed') return NextResponse.json({ issued: false, failed: true })
  if (checkout.status !== 'issued') return NextResponse.json({ issued: false })

  const { data: payments } = await supabase
    .from('ticket_payments')
    .select('ticket_id')
    .like('paystack_ref', `${ref}%`)

  // Decrypt access tokens — stored encrypted so a DB breach alone does not yield usable tokens
  const encryptedTokens = checkout.access_tokens as string[] | null
  let accessTokens: string[] = []
  if (encryptedTokens && encryptedTokens.length > 0) {
    try {
      accessTokens = encryptedTokens.map(enc => decryptSecret(enc, totpKey()))
    } catch {
      accessTokens = []
    }
  }

  return NextResponse.json({
    issued: true,
    ticket_ids: (payments ?? []).map((p: { ticket_id: string }) => p.ticket_id),
    access_tokens: accessTokens,
  })
}
