import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { getStaffSession } from '@/lib/staff-session'
import type { RedeemRaffleResult } from '@evolveit/shared/types'

// Marks a ticket's raffle win as redeemed. Scanner/door and bar screens both
// use this — a prize can be a free item honored at the bar or a gate
// upgrade honored at the door, so this isn't restricted to one station.
export async function POST(req: NextRequest) {
  const staff = await getStaffSession()
  if (!staff || !staff.roles.some((r) => ['door', 'bartender', 'owner', 'manager'].includes(r))) {
    return NextResponse.json({ ok: false, reason: 'ticket_not_admitted' } satisfies RedeemRaffleResult, { status: 401 })
  }

  const body = await req.json().catch(() => null) as { ticket_id?: string } | null
  if (!body?.ticket_id) {
    return NextResponse.json({ ok: false, reason: 'no_reward' } satisfies RedeemRaffleResult, { status: 400 })
  }

  const supabase = createSupabaseServiceRole()
  const { data: result } = await supabase.rpc('redeem_raffle_prize', {
    p_ticket_id: body.ticket_id,
    p_redeemed_by_user_id: staff.user_id,
  })

  return NextResponse.json(result as RedeemRaffleResult)
}
