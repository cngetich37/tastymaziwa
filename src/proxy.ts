import { NextResponse } from 'next/server';
import { auth } from '@/auth';

/**
 * First line of defence only: redirects signed-out visitors to /login.
 * Every page, server action and route handler still checks the session itself
 * (see src/server/session.ts) — never rely on the proxy alone.
 */
export default auth((req) => {
  if (req.auth) return;
  const login = new URL('/login', req.nextUrl.origin);
  login.searchParams.set('callbackUrl', req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(login);
});

export const config = {
  // Skip auth endpoints, cron (it has its own bearer token), static assets and the login page.
  matcher: ['/((?!api/auth|api/cron|_next/static|_next/image|favicon.ico|login).*)'],
};
