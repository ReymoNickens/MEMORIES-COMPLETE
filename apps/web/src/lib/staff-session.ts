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
  const s = process.env['HUB_SECRET'] || process.env['SUPABASE_JWT_SECRET']
  if (!s) throw new Error('HUB_SECRET or SUPABASE_JWT_SECRET must be set')
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

export function staffCookieHeader(session: StaffSession): string {
  const value = encodeStaffSession(session)
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${12 * 60 * 60}`
}

export function clearStaffCookieHeader(): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
}
