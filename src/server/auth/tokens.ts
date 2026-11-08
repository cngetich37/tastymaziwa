/**
 * One-time codes and tokens for email flows. Only an HMAC (keyed with
 * AUTH_SECRET) is stored, so a database leak doesn't reveal live secrets.
 */
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { authTokens, type AuthTokenPurpose } from '@/db/schema';
import { authConfig } from './config';

function secretKey(): string {
  const key = process.env.AUTH_SECRET;
  if (!key) throw new Error('AUTH_SECRET is not set');
  return key;
}

export function hashSecret(secret: string): string {
  return createHmac('sha256', secretKey()).update(secret).digest('base64url');
}

function sameHash(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Uniformly random 6-digit code, e.g. "042917". */
export const generateCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

/** 256-bit URL-safe token for emailed links. */
export const generateLinkToken = () => randomBytes(32).toString('base64url');

export async function issueToken(
  tx: Tx,
  input: {
    purpose: AuthTokenPurpose;
    email: string;
    secret: string;
    ttlSeconds: number;
    userId?: string | null;
    data?: unknown;
  },
) {
  // A new code supersedes older unused ones for the same purpose and address.
  await tx
    .update(authTokens)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(authTokens.email, input.email),
        eq(authTokens.purpose, input.purpose),
        isNull(authTokens.consumedAt),
      ),
    );
  const [row] = await tx
    .insert(authTokens)
    .values({
      purpose: input.purpose,
      email: input.email,
      userId: input.userId ?? null,
      tokenHash: hashSecret(input.secret),
      data: input.data ?? null,
      expiresAt: new Date(Date.now() + input.ttlSeconds * 1000),
    })
    .returning();
  return row;
}

export type CodeCheck =
  | { ok: true; token: typeof authTokens.$inferSelect }
  | { ok: false; reason: 'invalid' | 'expired' | 'too_many_attempts' };

/**
 * Check a 6-digit code against the latest live token for (email, purpose).
 * Every wrong guess counts; after `maxCodeAttempts` the code is dead.
 * On success the token is consumed (single use).
 */
export async function verifyCode(
  tx: Tx,
  email: string,
  purpose: AuthTokenPurpose,
  code: string,
): Promise<CodeCheck> {
  const [token] = await tx
    .select()
    .from(authTokens)
    .where(
      and(eq(authTokens.email, email), eq(authTokens.purpose, purpose), isNull(authTokens.consumedAt)),
    )
    .orderBy(desc(authTokens.createdAt))
    .limit(1);

  if (!token) return { ok: false, reason: 'invalid' };
  if (token.expiresAt.getTime() <= Date.now()) return { ok: false, reason: 'expired' };
  if (token.attempts >= authConfig.maxCodeAttempts) return { ok: false, reason: 'too_many_attempts' };

  if (!sameHash(hashSecret(code), token.tokenHash)) {
    const [updated] = await tx
      .update(authTokens)
      .set({ attempts: sql`${authTokens.attempts} + 1` })
      .where(eq(authTokens.id, token.id))
      .returning({ attempts: authTokens.attempts });
    return {
      ok: false,
      reason: updated.attempts >= authConfig.maxCodeAttempts ? 'too_many_attempts' : 'invalid',
    };
  }

  // Conditional update: two concurrent correct submissions can't both win.
  const consumed = await tx
    .update(authTokens)
    .set({ consumedAt: new Date() })
    .where(and(eq(authTokens.id, token.id), isNull(authTokens.consumedAt)))
    .returning({ id: authTokens.id });
  if (consumed.length === 0) return { ok: false, reason: 'invalid' };
  return { ok: true, token };
}

/** Find and consume a live link token (password reset / invite). */
export async function consumeLinkToken(tx: Tx, purpose: AuthTokenPurpose, secret: string) {
  const [token] = await tx
    .update(authTokens)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(authTokens.tokenHash, hashSecret(secret)),
        eq(authTokens.purpose, purpose),
        isNull(authTokens.consumedAt),
        gt(authTokens.expiresAt, new Date()),
      ),
    )
    .returning();
  return token ?? null;
}

/** Look up a live link token without consuming it (to render the reset page). */
export async function peekLinkToken(tx: Tx, purpose: AuthTokenPurpose, secret: string) {
  const [token] = await tx
    .select({ email: authTokens.email, expiresAt: authTokens.expiresAt, data: authTokens.data })
    .from(authTokens)
    .where(
      and(
        eq(authTokens.tokenHash, hashSecret(secret)),
        eq(authTokens.purpose, purpose),
        isNull(authTokens.consumedAt),
        gt(authTokens.expiresAt, new Date()),
      ),
    );
  return token ?? null;
}
