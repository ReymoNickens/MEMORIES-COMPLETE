import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { verifyPin } from '@evolveit/shared/crypto'
import { normalisePhone } from '@evolveit/shared/phone'
import { staffCookieHeader } from '@/lib/staff-session'
import type { StaffRole } from '@evolveit/shared/types'

function callerIp(req: NextRequest): string | null {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]!.trim()
  return req.headers.get('x-real-ip')
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { phone?: string; pin?: string } | null
  if (!body?.phone || !body?.pin) {
    return NextResponse.json({ error: 'Phone and PIN required' }, { status: 400 })
  }

  const phone = normalisePhone(body.phone)
  if (!phone) return NextResponse.json({ error: 'Invalid Ghana number' }, { status: 400 })

  const supabase = createSupabaseServiceRole()
  const ip = callerIp(req)

  // A four-digit PIN is 10,000 guesses. Before this, nothing counted them.
  const { data: waitFor } = await supabase.rpc('staff_login_lockout', {
    p_phone: phone,
    p_ip: ip,
  })
  if (typeof waitFor === 'number' && waitFor > 0) {
    return NextResponse.json(
      {
        error: `Too many wrong PINs. Try again in ${Math.ceil(waitFor / 60)} minute(s), or ask the duty manager.`,
        retry_after_seconds: waitFor,
      },
      { status: 429, headers: { 'Retry-After': String(waitFor) } },
    )
  }

  const record = async (succeeded: boolean, tenantId?: string) => {
    await supabase.from('staff_login_attempts').insert({
      tenant_id: tenantId ?? null,
      phone,
      succeeded,
      ip,
    })
  }

  // `phone` is unique per (tenant_id, phone), not globally — .single() threw on
  // the second tenant to onboard a number. maybeSingle plus an explicit
  // active filter keeps this correct as soon as there is more than one venue.
  const { data: users } = await supabase
    .from('users')
    .select('id, tenant_id, full_name, is_active')
    .eq('phone', phone)
    .eq('is_active', true)
    .not('tenant_id', 'is', null)
    .limit(2)

  const matches = (users ?? []) as Array<{ id: string; tenant_id: string; full_name: string }>

  // Same shape of response and roughly the same work whether the phone exists
  // or not, so the endpoint does not confirm which numbers are on the roster.
  if (matches.length !== 1) {
    await record(false)
    return NextResponse.json({ error: 'Wrong number or PIN' }, { status: 401 })
  }

  const user = matches[0]!

  const { data: cred } = await supabase
    .from('staff_credentials')
    .select('user_id, pin_hash')
    .eq('user_id', user.id)
    .maybeSingle()

  const pepper = process.env['PIN_PEPPER'] ?? ''
  if (!cred || !verifyPin(body.pin, user.tenant_id, cred.pin_hash as string, pepper)) {
    await record(false, user.tenant_id)
    return NextResponse.json({ error: 'Wrong number or PIN' }, { status: 401 })
  }

  const { data: roles } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .eq('tenant_id', user.tenant_id)

  await record(true, user.tenant_id)

  const session = {
    user_id: user.id,
    tenant_id: user.tenant_id,
    full_name: user.full_name,
    roles: ((roles ?? []) as { role: StaffRole }[]).map(r => r.role),
  }

  const res = NextResponse.json({ ok: true, session })
  res.headers.append('Set-Cookie', staffCookieHeader(session))
  return res
}
