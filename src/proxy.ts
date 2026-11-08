import { NextResponse } from 'next/server';
import { auth } from '@/auth';

/** Pages reachable without a session. */
const PUBLIC_PATHS = ['/login', '/signup', '/forgot-password', '/reset-password'];

/**
 * First line of defence only: redirects signed-out visitors to /login and,
 * on every request, slides the session's idle expiry forward.
 * Every page, server action and route handler still checks the session itself
 * (see src/server/session.ts) — never rely on the proxy alone.
 */
export default auth((req) => {
  const { pathname, search } = req.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (req.auth || isPublic) return;

  const login = new URL('/login', req.nextUrl.origin);
  login.searchParams.set('callbackUrl', pathname + search);
  // A session cookie that no longer yields a session = it expired or was revoked.
  if (req.cookies.getAll().some((c) => c.name.includes('authjs.session-token'))) {
    login.searchParams.set('reason', 'expired');
  }
  return NextResponse.redirect(login);
});

export const config = {
  // Skip auth endpoints, cron (it has its own bearer token) and static assets.
  matcher: ['/((?!api/auth|api/cron|_next/static|_next/image|favicon.ico).*)'],
};
