import { NextRequest, NextResponse } from 'next/server'
import { decodeStaffSession } from '@/lib/staff-session'

// Routes that require an active staff session
const PROTECTED_PREFIXES = [
  '/dashboard',
  '/organiser',
  '/bar',
  '/kitchen',
  '/floor',
  '/waiter',
  '/scanner',
  '/reissue',
  '/staff/claim',
]

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  const needsAuth = PROTECTED_PREFIXES.some(p => pathname === p || pathname.startsWith(`${p}/`))
  if (!needsAuth) return NextResponse.next()

  const token = req.cookies.get('evolveit_staff')?.value
  const session = token ? decodeStaffSession(token) : null

  if (!session) {
    const login = req.nextUrl.clone()
    login.pathname = '/staff/login'
    login.searchParams.set('next', pathname)
    return NextResponse.redirect(login)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/organiser/:path*',
    '/bar/:path*',
    '/kitchen/:path*',
    '/floor/:path*',
    '/waiter/:path*',
    '/scanner/:path*',
    '/reissue/:path*',
    '/staff/claim/:path*',
  ],
}
