import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { verifyPin } from '@evolveit/shared/crypto'
import { normalisePhone } from '@evolveit/shared/phone'
import { staffCookieHeader } from '@/lib/staff-session'
import type { StaffRole } from '@evolveit/shared/types'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { phone?: string; pin?: string } | null
  if (!body?.phone || !body?.pin) {
    return NextResponse.json({ error: 'Phone and PIN required' }, { status: 400 })
  }

  const phone = normalisePhone(body.phone)
  if (!phone) return NextResponse.json({ error: 'Invalid Ghana number' }, { status: 400 })

  const supabase = createSupabaseServiceRole()
  const { data: user } = await supabase
    .from('users')
    .select('id, tenant_id, full_name, is_active')
    .eq('phone', phone)
    .single()

  if (!user || !user.is_active || !user.tenant_id) {
    return NextResponse.json({ error: 'Unknown staff phone' }, { status: 401 })
  }

  const { data: cred } = await supabase
    .from('staff_credentials')
    .select('user_id, pin_hash')
    .eq('user_id', user.id)
    .single()

  const pepper = process.env['PIN_PEPPER'] ?? ''
  if (!cred || !verifyPin(body.pin, user.tenant_id as string, cred.pin_hash as string, pepper)) {
    return NextResponse.json({ error: 'Wrong PIN' }, { status: 401 })
  }

  const { data: roles } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)

  const session = {
    user_id: user.id,
    tenant_id: user.tenant_id as string,
    full_name: user.full_name as string,
    roles: ((roles ?? []) as { role: StaffRole }[]).map(r => r.role),
  }

  const res = NextResponse.json({ ok: true, session })
  res.headers.append('Set-Cookie', staffCookieHeader(session))
  return res
}
