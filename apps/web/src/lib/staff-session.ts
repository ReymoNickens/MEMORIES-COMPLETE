import { cookies } from 'next/headers'
import { signPayload, verifySignedPayload } from '@evolveit/shared/crypto'
import type { StaffRole } from '@evolveit/shared/types'

export interface StaffSession {
  user_id: string
  tenant_id: string
  full_name: string
  roles: StaffRole[]
  station_kind?: string
  station_label?: string
}

const COOKIE = 'evolveit_staff'

function secret(): string {
  // Dedicated signing key for staff session cookies — must never be shared with
  // HUB_SECRET (used for device-key HMAC) or any other system secret.
  const s = process.env['STAFF_SESSION_SECRET']
  if (!s) throw new Error('STAFF_SESSION_SECRET must be set')
  return s
}

export function encodeStaffSession(session: StaffSession): string {
  return signPayload(JSON.stringify(session), secret())
}

export function decodeStaffSession(token: string): StaffSession | null {
  const raw = verifySignedPayload(token, secret())
  if (!raw) return null
  try {
    return JSON.parse(raw) as StaffSession
  } catch {
    return null
  }
}

export async function getStaffSession(): Promise<StaffSession | null> {
  const jar = await cookies()
  const token = jar.get(COOKIE)?.value
  if (!token) return null
  return decodeStaffSession(token)
}

/**
 * Like getStaffSession but also validates the user is still active in the DB.
 * Use this in routes that perform privileged or financial operations so that
 * a deactivated staff member's cookie cannot be replayed until it expires.
 */
export async function getValidatedStaffSession(
  supabase: { from: (table: string) => { select: (cols: string) => { eq: (col: string, val: string) => { single: () => Promise<{ data: { is_active: boolean } | null }> } } } }
): Promise<StaffSession | null> {
  const session = await getStaffSession()
  if (!session) return null
  const { data: user } = await (supabase.from('users') as any)
    .select('is_active')
    .eq('id', session.user_id)
    .eq('tenant_id', session.tenant_id)
    .single()
  if (!user?.is_active) return null
  return session
}

export function staffCookieHeader(session: StaffSession): string {
  const value = encodeStaffSession(session)
  const secure = process.env['NODE_ENV'] === 'production' ? '; Secure' : ''
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${12 * 60 * 60}${secure}`
}

export function clearStaffCookieHeader(): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
}
