import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { randomToken, sha256Hex } from '@evolveit/shared/crypto'
import { normalisePhone } from '@evolveit/shared/phone'

/**
 * Hand a paying buyer back the ticket they bought.
 *
 * The access token is minted in Node at issuance and only its hash is stored,
 * so when the webhook issues server-side the raw token exists nowhere the
 * browser can read. The return page polled until the tickets appeared and then
 * did nothing with them. Since `sendTicketDelivery()` is not called from
 * anywhere in the repo either, a live customer paid and received nothing.
 *
 * Two things are required, and only the buyer has both: the checkout reference
 * (24 random hex characters, in their callback URL) and the phone number the
 * tickets were bought against.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { reference?: string; phone?: string } | null
  if (!body?.reference || !body.phone) {
    return NextResponse.json({ error: 'Reference and phone number required' }, { status: 400 })
  }

  const phone = normalisePhone(body.phone)
  if (!phone) return NextResponse.json({ error: 'Invalid Ghana phone number' }, { status: 400 })

  const supabase = createSupabaseServiceRole()

  const { data: checkout } = await supabase
    .from('pending_checkouts')
    .select('id, quantity, status')
    .eq('paystack_ref', body.reference)
    .maybeSingle()

  if (!checkout) return NextResponse.json({ error: 'Unknown reference' }, { status: 404 })
  if (checkout.status !== 'issued') {
    return NextResponse.json({ error: 'Those tickets have not been issued yet', pending: true }, { status: 409 })
  }

  const { data: payments } = await supabase
    .from('ticket_payments')
    .select('ticket_id, created_at')
    .like('paystack_ref', `${body.reference}-%`)
    .order('created_at')

  const ids = ((payments ?? []) as Array<{ ticket_id: string }>).map(p => p.ticket_id)
  if (ids.length === 0) return NextResponse.json({ error: 'No tickets found' }, { status: 404 })

  const tokens = ids.map(() => randomToken(18))
  const grants = ids.map((ticket_id, i) => ({ ticket_id, access_hash: sha256Hex(tokens[i]!) }))

  const { data, error } = await supabase.rpc('claim_ticket_access', {
    p_paystack_ref: body.reference,
    p_phone: phone,
    p_grants: grants,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const result = data as { ok?: boolean; reason?: string; ticket_ids?: string[] }
  if (!result?.ok) {
    // Deliberately vague: the reference alone should not confirm whose number
    // a ticket was bought under.
    return NextResponse.json({ error: 'That reference and number do not match' }, { status: 401 })
  }

  return NextResponse.json({
    ok: true,
    tickets: (result.ticket_ids ?? []).map((id, i) => ({ id, access: tokens[i] })),
  })
}
