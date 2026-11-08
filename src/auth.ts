import { createHmac, timingSafeEqual } from 'node:crypto';
import NextAuth, { CredentialsSignin, type DefaultSession } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
// Brings next-auth/jwt into the program so the JWT augmentation below applies.
import type {} from 'next-auth/jwt';
import type { Role } from '@/db/schema';
import { codeLoginSchema, passwordLoginSchema } from '@/lib/validation';
import { authConfig } from '@/server/auth/config';

declare module 'next-auth' {
  interface Session {
    user: { id: string; role: Role; shopId: string } & DefaultSession['user'];
  }
  interface User {
    role?: Role;
    shopId?: string;
    sessionVersion?: number;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string;
    role?: Role;
    shopId?: string;
    /** users.session_version at sign-in; a mismatch ends the session. */
    sv?: number;
    /** Sign-in time (ms) for the absolute session limit. */
    authTime?: number;
    /** Last time the user row was re-checked (ms). */
    checkedAt?: number;
  }
}

/** Error codes reach the client as `result.code` (keep them non-sensitive). */
class SignInFailed extends CredentialsSignin {
  constructor(code: string) {
    super();
    this.code = code;
  }
}

/**
 * Proof that the server itself bumped this user's session version (after a
 * password change), so `update()` calls from the browser can't forge one.
 */
export function sessionVersionProof(userId: string, version: number): string {
  return createHmac('sha256', process.env.AUTH_SECRET ?? '')
    .update(`sv:${userId}:${version}`)
    .digest('base64url');
}

function validProof(userId: string, version: unknown, proof: unknown): version is number {
  if (typeof version !== 'number' || typeof proof !== 'string') return false;
  const expected = Buffer.from(sessionVersionProof(userId, version));
  const given = Buffer.from(proof);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// Imported lazily so the proxy bundle only loads the database when needed.
const accounts = () => import('@/server/auth/accounts');
const database = () => import('@/db').then((m) => m.getDb());

export const { handlers, signIn, signOut, auth, unstable_update: updateSession } = NextAuth({
  // AUTH_SECRET is read from the environment; Auth.js refuses to run without it.
  // maxAge is the IDLE timeout: every request re-issues the cookie with a fresh expiry.
  session: { strategy: 'jwt', maxAge: authConfig.sessionIdleSeconds },
  pages: { signIn: '/login' },
  providers: [
    Credentials({
      id: 'password',
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const parsed = passwordLoginSchema.safeParse(raw);
        if (!parsed.success) throw new SignInFailed('invalid');
        const { passwordLogin } = await accounts();
        const result = await passwordLogin(await database(), parsed.data.email, parsed.data.password);
        if (typeof result === 'string') throw new SignInFailed(result);
        return result;
      },
    }),
    Credentials({
      // Passwordless sign-in, and the final step of sign-up.
      id: 'email-code',
      credentials: { email: {}, code: {}, intent: {} },
      async authorize(raw) {
        const parsed = codeLoginSchema.safeParse(raw);
        if (!parsed.success) throw new SignInFailed('invalid');
        const { completeSignup, verifyLoginCode } = await accounts();
        const db = await database();
        const result =
          (raw as { intent?: string }).intent === 'signup'
            ? await completeSignup(db, parsed.data.email, parsed.data.code)
            : await verifyLoginCode(db, parsed.data.email, parsed.data.code);
        if (typeof result === 'string') throw new SignInFailed(result);
        return result;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      const now = Date.now();

      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.shopId = user.shopId;
        token.sv = user.sessionVersion;
        token.authTime = now;
        token.checkedAt = now;
        return token;
      }

      // Hard limit: re-authenticate after one shift, however active.
      if (!token.id || !token.authTime || now - token.authTime > authConfig.sessionMaxSeconds * 1000) {
        return null;
      }

      // Accept a new session version only with the server's signed proof.
      const update = session as { sv?: unknown; svProof?: unknown } | undefined;
      const provenVersion =
        trigger === 'update' && validProof(token.id, update?.sv, update?.svProof) ? update!.sv : undefined;

      if (provenVersion !== undefined || now - (token.checkedAt ?? 0) > authConfig.sessionRecheckSeconds * 1000) {
        const { getSessionState } = await accounts();
        const state = await getSessionState(await database(), token.id);
        const expected = provenVersion ?? token.sv;
        // Deactivated, deleted, or password changed elsewhere → sign out.
        if (!state || !state.active || state.sessionVersion !== expected) return null;
        token.sv = state.sessionVersion;
        token.role = state.role;
        token.name = state.name;
        token.email = state.email;
        token.checkedAt = now;
      }
      return token;
    },
    session({ session, token }) {
      if (token.id) session.user.id = token.id;
      if (token.role) session.user.role = token.role;
      if (token.shopId) session.user.shopId = token.shopId;
      return session;
    },
  },
});
