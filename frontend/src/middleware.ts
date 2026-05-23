import { NextRequest, NextResponse } from 'next/server'

// Redirect logged-in users away from these
const AUTH_PAGES = ['/login', '/signup']
// Accessible without login, no redirect if already logged in
const PUBLIC_PAGES = ['/forgot-password', '/reset-password']

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const token = request.cookies.get('auth-token')?.value

  if (PUBLIC_PAGES.some(p => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  const isAuthPage = AUTH_PAGES.some(p => pathname.startsWith(p))
  if (!token && !isAuthPage) {
    return NextResponse.redirect(new URL('/login', request.url))
  }
  if (token && isAuthPage) {
    return NextResponse.redirect(new URL('/', request.url))
  }
  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api|.*\\.(?:jpg|jpeg|png|svg|gif|webp|ico|woff2?|ttf|otf|css|js)).*)',
  ],
}
