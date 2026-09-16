import type { StaffRole } from '@evolveit/shared/types'

// Single source of truth for "what can this role do after login" — used
// server-side to decide what /api/staff/me offers and to enforce
// /api/staff/claim (the actual authorization boundary), and client-side to
// route a freshly logged-in staff member straight to their screen instead
// of dropping everyone on the same claim page regardless of role.
export const ALL_STATION_KINDS = ['door', 'bar', 'kitchen', 'floor', 'cashier'] as const
export type StationKind = (typeof ALL_STATION_KINDS)[number]

export const ROLE_STATIONS: Record<StaffRole, StationKind[]> = {
  owner: [...ALL_STATION_KINDS],
  manager: [...ALL_STATION_KINDS],
  event_manager: [...ALL_STATION_KINDS],
  door: ['door'],
  // front_office has its own screen (sell a walk-up ticket, validate,
  // book a table) rather than claiming a door or floor station — see
  // PRIVILEGED_DESTINATIONS below.
  front_office: [],
  bartender: ['bar'],
  kitchen: ['kitchen'],
  waiter: ['floor'],
  cashier: ['cashier'],
  // Roles that hold no station: they have no till and no rail to work.
  organiser: [],
  hr: [],
  finance: [],
  dj: [],
  mc: [],
}

export function stationKindsForRoles(roles: StaffRole[]): StationKind[] {
  const kinds = new Set<StationKind>()
  for (const role of roles) {
    for (const kind of ROLE_STATIONS[role] ?? []) kinds.add(kind)
  }
  return [...kinds]
}

const PRIVILEGED_DESTINATIONS: Array<[StaffRole, string]> = [
  ['owner', '/dashboard'],
  ['manager', '/dashboard'],
  ['event_manager', '/admin'],
  ['organiser', '/organiser'],
  ['front_office', '/front-office'],
]

// A privileged role (owner, manager, event_manager, organiser) can also
// hold ALL_STATION_KINDS in ROLE_STATIONS — an owner is allowed to work the
// door on a busy night — but that's an option, not where they should land
// by default. Their office screen wins; /staff/claim is still reachable
// directly for the night they're covering a station.
export function directDestinationForRoles(roles: StaffRole[]): string {
  for (const [role, dest] of PRIVILEGED_DESTINATIONS) {
    if (roles.includes(role)) return dest
  }
  // hr, finance, dj, mc: no dedicated screens exist yet (tracked as
  // follow-up work). Land them somewhere honest rather than a dead end.
  return '/staff/home'
}

// What a freshly logged-in staff member should see first: their office
// screen if they hold a privileged role, the station-claim screen if their
// only roles are frontline ones with a station to pick, otherwise the
// neutral landing.
export function landingPathForRoles(roles: StaffRole[]): string {
  if (PRIVILEGED_DESTINATIONS.some(([role]) => roles.includes(role))) {
    return directDestinationForRoles(roles)
  }
  return stationKindsForRoles(roles).length > 0 ? '/staff/claim' : '/staff/home'
}
