import { NextResponse } from 'next/server'
import { getStaffSession, type StaffSession } from '@/lib/staff-session'

// Section 4's role split: owner/manager get full access; event_manager gets
// event/ticket-type/raffle content but not venue-wide settings, which stay
// owner/manager only per the brief. Enforced here, not just hidden in the
// UI — a role with no server-side check is not a real boundary.
const CONTENT_ROLES = ['owner', 'manager', 'event_manager'] as const
const SETTINGS_ROLES = ['owner', 'manager'] as const

export async function requireContentAdmin(): Promise<
  { staff: StaffSession } | { error: NextResponse }
> {
  const staff = await getStaffSession()
  if (!staff || !staff.roles.some(r => (CONTENT_ROLES as readonly string[]).includes(r))) {
    return { error: NextResponse.json({ error: 'forbidden' }, { status: staff ? 403 : 401 }) }
  }
  return { staff }
}

export async function requireSettingsAdmin(): Promise<
  { staff: StaffSession } | { error: NextResponse }
> {
  const staff = await getStaffSession()
  if (!staff || !staff.roles.some(r => (SETTINGS_ROLES as readonly string[]).includes(r))) {
    return { error: NextResponse.json({ error: 'forbidden' }, { status: staff ? 403 : 401 }) }
  }
  return { staff }
}
