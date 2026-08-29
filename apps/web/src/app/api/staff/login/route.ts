import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { hashPin, hashPinStrong, verifyPinStrong } from '@evolveit/shared/crypto'
import { timingSafeEqual } from 'node:crypto'
import { normalisePhone } from '@evolveit/shared/phone'
import { staffCookieHeader, type StaffSession } from '@/lib/staff-session'
import type { StaffRole } from '@evolveit/shared/types'

// In-memory rate limiter: 5 attempts per phone per 15 minutes
// For multi-instance deployments, replace with a Redis-backed store
const WINDOW_MS = 15 * 60 * 1000
const MAX_ATTEMPTS = 5
const attempts = new Map<string, { count: number; windowStart: number }>()

function checkRateLimit(phone: string): boolean {
  const now = Date.now()
  const record = attempts.get(phone)
  if (!record || now - record.windowStart > WINDOW_MS) {
    attempts.set(phone, { count: 1, windowStart: now })
    return true
  }
  record.count++
  return record.count <= MAX_ATTEMPTS
}

function resetRateLimit(phone: string): void {
  attempts.delete(phone)
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { phone?: string; pin?: string } | null
  if (!body?.phone || !body?.pin) {
    return NextResponse.json({ error: 'Phone and PIN required' }, { status: 400 })
  }

  const phone = normalisePhone(body.phone)
  if (!phone) return NextResponse.json({ error: 'Invalid Ghana number' }, { status: 400 })

  if (!checkRateLimit(phone)) {
    return NextResponse.json({ error: 'Too many attempts — try again in 15 minutes' }, { status: 429 })
  }

  const INVALID = 'Invalid credentials'
  const supabase = createSupabaseServiceRole()

  const { data: user } = await supabase
    .from('users')
    .select('id, tenant_id, full_name, is_active')
    .eq('phone', phone)
    .single()

  if (!user || !user.is_active || !user.tenant_id) {
    // Uniform error — don't reveal whether the phone exists
    return NextResponse.json({ error: INVALID }, { status: 401 })
  }

  const { data: cred } = await supabase
    .from('staff_credentials')
    .select('user_id, pin_hash, pin_hash_v2')
    .eq('user_id', user.id)
    .single()

  if (!cred) return NextResponse.json({ error: INVALID }, { status: 401 })

  let valid = false
  let needsUpgrade = false

  if (cred.pin_hash_v2) {
    // Modern path: PBKDF2-SHA256 with per-credential salt
    valid = verifyPinStrong(body.pin, cred.pin_hash_v2 as string)
  } else {
    // Legacy path: plain SHA-256 — verify then upgrade transparently
    const legacy = hashPin(body.pin, user.tenant_id as string)
    const a = Buffer.from(legacy, 'hex')
    const b = Buffer.from(cred.pin_hash as string, 'hex')
    valid = a.length === b.length && timingSafeEqual(a, b)
    if (valid) needsUpgrade = true
  }

  if (!valid) return NextResponse.json({ error: INVALID }, { status: 401 })

  // Silently upgrade legacy SHA-256 hash to PBKDF2 on next login
  if (needsUpgrade) {
    const { encoded } = hashPinStrong(body.pin)
    void supabase.from('staff_credentials').update({ pin_hash_v2: encoded }).eq('user_id', user.id)
  }

  // Successful login — clear rate limit counter
  resetRateLimit(phone)

  const { data: roles } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)

  const session: StaffSession = {
    user_id: user.id,
    tenant_id: user.tenant_id as string,
    full_name: user.full_name as string,
    roles: ((roles ?? []) as { role: StaffRole }[]).map(r => r.role),
  }

  const res = NextResponse.json({ ok: true, session })
  res.headers.append('Set-Cookie', staffCookieHeader(session))
  return res
}
