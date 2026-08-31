import { NextRequest, NextResponse } from 'next/server'

/**
 * Redirect an obviously signed-out visitor before the page shell renders.
 *
 * This is presence-only — it checks that the cookie exists, nothing more.
 * It cannot verify the HMAC signature: that needs node:crypto, and Next 14's
 * Edge Middleware runtime does not support node:crypto (confirmed by trying —
 * importing @evolveit/shared/crypto here fails the build with
 * "node:crypto ... Unhandled scheme"). The real security boundary is
 * unchanged: every protected API route still calls getStaffSession(), which
 * verifies the signature and expiry in the Node runtime. A forged, tampered,
 * or expired cookie passes this check and is still correctly rejected there.
 * All this buys is skipping the flash of a page shell — and the extra API
 * round trip — for the common case of no cookie at all.
 */
const PROTECTED_PREFIXES = ['/dashboard', '/organiser', '/bar', '/kitchen', '/floor', '/waiter', '/reissue', '/staff/claim']

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const needsAuth = PROTECTED_PREFIXES.some(p => pathname === p || pathname.startsWith(`${p}/`))
  if (!needsAuth) return NextResponse.next()

  if (!req.cookies.get('memories_staff')?.value) {
    const login = req.nextUrl.clone()
    login.pathname = '/staff/login'
    login.searchParams.set('next', pathname)
    return NextResponse.redirect(login)
  }
  return NextResponse.next()
}

export const config = {
  matcher: [
    '/dashboard/:path*', '/organiser/:path*', '/bar/:path*', '/kitchen/:path*',
    '/floor/:path*', '/waiter/:path*', '/reissue/:path*', '/staff/claim/:path*',
  ],
}
