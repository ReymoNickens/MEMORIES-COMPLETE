import { cookies } from 'next/headers'
import { signPayload, verifySignedPayload } from '@evolveit/shared/crypto'
import type { StaffRole } from '@evolveit/shared/types'
import { createSupabaseServiceRole } from '@/lib/supabase/server'

export interface StaffSession {
  user_id: string
  tenant_id: string
  full_name: string
  roles: StaffRole[]
  station_kind?: string
  station_label?: string
  iat: number
  exp: number
}

const COOKIE = 'memories_staff'
const TWELVE_HOURS = 12 * 60 * 60

export function staffSessionSecret(): string {
  const explicit = process.env['STAFF_SESSION_SECRET'] || process.env['HUB_SECRET']
  if (explicit) return explicit
  if (process.env['EVOLVEIT_DEMO'] === '1') return 'evolveit-demo-staff-session-not-for-prod'
  throw new Error('STAFF_SESSION_SECRET is required outside demo mode')
}

export function encodeStaffSession(session: Omit<StaffSession, 'iat' | 'exp'>): string {
  const now = Math.floor(Date.now() / 1000)
  const full: StaffSession = { ...session, iat: now, exp: now + TWELVE_HOURS }
  return signPayload(JSON.stringify(full), staffSessionSecret())
}

export function decodeStaffSession(token: string): StaffSession | null {
  let secret: string
  try {
    secret = staffSessionSecret()
  } catch {
    return null
  }
  const raw = verifySignedPayload(token, secret)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as StaffSession
    if (!parsed.user_id || !parsed.tenant_id || !parsed.exp) return null
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null
    return parsed
  } catch {
    return null
  }
}

export async function getStaffSession(): Promise<StaffSession | null> {
  const jar = await cookies()
  const token = jar.get(COOKIE)?.value
  if (!token) return null
  const session = decodeStaffSession(token)
  if (!session) return null

  // A signed, unexpired cookie is only proof of who signed in up to 12 hours
  // ago — not that the account is still live now. Without this, deactivating
  // a fired staff member or one whose PIN leaked does nothing until their
  // cookie happens to expire on its own. One indexed lookup on the primary
  // key, on every request that already needs a DB round trip anyway.
  const supabase = createSupabaseServiceRole()
  const { data: user } = await supabase
    .from('users')
    .select('is_active')
    .eq('id', session.user_id)
    .eq('tenant_id', session.tenant_id)
    .maybeSingle()
  if (!user?.is_active) return null

  return session
}

export function staffCookieHeader(session: Omit<StaffSession, 'iat' | 'exp'>): string {
  const value = encodeStaffSession(session)
  const secure = process.env['NODE_ENV'] === 'production' ? '; Secure' : ''
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TWELVE_HOURS}${secure}`
}

export function clearStaffCookieHeader(): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
}
