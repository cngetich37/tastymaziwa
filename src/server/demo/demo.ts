/**
 * "Try the demo": a private sandbox shop per visitor, full of sample trading
 * (see data.ts), signed in with one tap and no email.
 *
 * - Each visitor gets their own shop, so they can record, reverse and pay
 *   freely without seeing anyone else's test data. Tenant isolation is the
 *   same as for real shops.
 * - The shop has an owner, a seller and a supplier login; the visitor can
 *   switch between them to see each role's view.
 * - Nothing leaves the building: invites, email changes, M-Pesa and WhatsApp
 *   are refused for demo shops (guard.ts), and demo addresses are `.invalid`.
 * - Demo shops expire after DEMO_TTL and are purged by the daily cron (and
 *   lazily when a new demo starts). Only expired demo shops can have ledger
 *   and audit rows deleted: the database enforces that (migration 0015).
 *
 * Sign-in uses a short-lived HMAC token (the `demo` Auth.js provider). It is
 * only ever valid for a user of a live demo shop.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, asc, count, eq, gt, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import type { DB } from '@/db/client';
import {
  attendance,
  auditLog,
  authTokens,
  customers,
  deliverySubmissions,
  employeeAdvances,
  employees,
  expenseBudgets,
  ledgerEntries,
  mpesaC2bTransactions,
  mpesaRequests,
  mpesaSettings,
  payrollLines,
  payrollRuns,
  products,
  shiftCloses,
  shops,
  subscriptions,
  suppliers,
  users,
  type Role,
} from '@/db/schema';
import type { AuthUser } from '../auth/accounts';
import { authConfig } from '../auth/config';
import { consume } from '../auth/rate-limit';
import { DomainError, type Actor } from '../ledger';
import { populateDemoShop } from './data';
import { DEMO_EMAIL_DOMAIN } from './guard';

export const DEMO_SHOP_NAME = 'Baraka Milk Bar (demo)';

/** Sign-in tokens are used straight away by the browser that asked for them. */
const TOKEN_TTL_MS = 2 * 60_000;

const positiveInt = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

export const demoConfig = {
  /** Off with DEMO_DISABLED=1 (hides the button and refuses new demos). */
  get enabled() {
    return !['1', 'true'].includes(process.env.DEMO_DISABLED ?? '');
  },
  /** A demo outlives the longest possible session, so no one is purged mid-session. */
  get ttlSeconds() {
    return Math.max(24 * 60 * 60, authConfig.sessionMaxSeconds + 60 * 60);
  },
  /** New demos per IP per hour. */
  get perIpPerHour() {
    return positiveInt('RATE_LIMIT_DEMOS_PER_IP', 5);
  },
  /** Live demo shops at once, across everyone: protects the database. */
  get maxLive() {
    return positiveInt('DEMO_MAX_LIVE', 300);
  },
};

// --- sign-in tokens --------------------------------------------------------------------

function sign(userId: string, expires: number): string {
  const key = process.env.AUTH_SECRET;
  if (!key) throw new Error('AUTH_SECRET is not set');
  return createHmac('sha256', key).update(`demo-signin:${userId}:${expires}`).digest('base64url');
}

export function demoSignInToken(userId: string, now = Date.now()): string {
  const expires = now + TOKEN_TTL_MS;
  return `${userId}.${expires}.${sign(userId, expires)}`;
}

/** The `demo` provider's check: a valid, unexpired token for an active user of a live demo shop. */
export async function verifyDemoSignIn(db: DB, token: string): Promise<AuthUser | 'invalid'> {
  const [userId, expiresRaw, signature, ...rest] = token.split('.');
  const expires = Number(expiresRaw);
  if (!userId || !signature || rest.length > 0 || !Number.isFinite(expires) || expires < Date.now()) return 'invalid';
  const expected = Buffer.from(sign(userId, expires));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return 'invalid';
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return 'invalid';

  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      shopId: users.shopId,
      sessionVersion: users.sessionVersion,
    })
    .from(users)
    .innerJoin(shops, eq(shops.id, users.shopId))
    .where(and(eq(users.id, userId), eq(users.active, true), isNotNull(shops.demoExpiresAt), gt(shops.demoExpiresAt, sql`now()`)));
  return user ?? 'invalid';
}

// --- starting a demo ---------------------------------------------------------------------

export type StartDemoResult = { token: string; shopId: string } | 'rate_limited' | 'busy' | 'disabled';

/** Create a fresh demo shop for this visitor; returns a sign-in token for its owner. */
export async function startDemo(db: DB, ip: string, now = new Date()): Promise<StartDemoResult> {
  if (!demoConfig.enabled) return 'disabled';
  // Housekeeping first, so expired demos never count against the cap.
  await purgeExpiredDemos(db, 5).catch((error) => console.error('[demo] purge failed', error));
  if (!(await consume(db, [{ key: `demo:ip:${ip}`, max: demoConfig.perIpPerHour, windowSeconds: 3600 }]))) {
    return 'rate_limited';
  }
  const [live] = await db
    .select({ n: count() })
    .from(shops)
    .where(and(isNotNull(shops.demoExpiresAt), gt(shops.demoExpiresAt, sql`now()`)));
  if ((live?.n ?? 0) >= demoConfig.maxLive) return 'busy';

  const { shopId, ownerId } = await createDemoShop(db, {
    expiresAt: new Date(now.getTime() + demoConfig.ttlSeconds * 1000),
    now,
  });
  return { token: demoSignInToken(ownerId, now.getTime()), shopId };
}

/** The shop, its three logins and the sample data, in one transaction. */
export async function createDemoShop(db: DB, opts: { expiresAt: Date; now?: Date }) {
  const tag = randomBytes(6).toString('hex');
  const email = (who: string) => `${who}.${tag}@${DEMO_EMAIL_DOMAIN}`;
  return db.transaction(async (tx) => {
    const [shop] = await tx.insert(shops).values({ name: DEMO_SHOP_NAME, demoExpiresAt: opts.expiresAt }).returning();
    const [owner] = await tx
      .insert(users)
      .values({ shopId: shop.id, name: 'Amina Wairimu', email: email('owner'), emailVerifiedAt: new Date(), role: 'owner' })
      .returning({ id: users.id });
    await tx.insert(auditLog).values({
      shopId: shop.id,
      userId: owner.id,
      action: 'shop.create',
      entityType: 'shop',
      entityId: shop.id,
      data: { name: shop.name, via: 'demo', expiresAt: opts.expiresAt.toISOString() },
    });
    const result = await populateDemoShop(tx, {
      shopId: shop.id,
      ownerId: owner.id,
      emails: { seller: email('seller'), supplier: email('supplier') },
      now: opts.now,
    });
    return { shopId: shop.id, ownerId: owner.id, ...result };
  });
}

/** In a demo shop, a sign-in token for the same shop's login with `role`. */
export async function demoSwitchToken(db: DB, actor: Actor, role: Role): Promise<string> {
  const [shop] = await db.select({ demoExpiresAt: shops.demoExpiresAt }).from(shops).where(eq(shops.id, actor.shopId));
  if (!shop?.demoExpiresAt) throw new DomainError('Switching roles only works in the demo shop');
  if (shop.demoExpiresAt <= new Date()) throw new DomainError('This demo has expired. Start a new one.');
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.shopId, actor.shopId), eq(users.role, role), eq(users.active, true)))
    .orderBy(asc(users.createdAt))
    .limit(1);
  if (!user) throw new DomainError('There is no active login with that role in this demo. Check Settings → People.');
  return demoSignInToken(user.id);
}

// --- purging -----------------------------------------------------------------------------

/**
 * Delete expired demo shops and everything in them, children first. Each
 * shop is one transaction. The append-only triggers allow these deletes only
 * because the shop is an expired demo.
 */
export async function purgeExpiredDemos(db: DB, limit = 50): Promise<number> {
  const expired = await db
    .select({ id: shops.id })
    .from(shops)
    .where(and(isNotNull(shops.demoExpiresAt), lte(shops.demoExpiresAt, sql`now()`)))
    .limit(limit);
  for (const { id } of expired) {
    await db.transaction(async (tx) => {
      const shopUsers = tx.select({ id: users.id }).from(users).where(eq(users.shopId, id));
      await tx.delete(authTokens).where(inArray(authTokens.userId, shopUsers));
      for (const table of [
        mpesaC2bTransactions,
        mpesaRequests,
        mpesaSettings,
        payrollLines,
        employeeAdvances,
        payrollRuns,
        attendance,
        employees,
        deliverySubmissions,
        shiftCloses,
        ledgerEntries,
        auditLog,
        subscriptions,
        expenseBudgets,
        products,
        users,
        customers,
        suppliers,
      ]) {
        await tx.delete(table).where(eq(table.shopId, id));
      }
      await tx.delete(shops).where(eq(shops.id, id));
    });
  }
  return expired.length;
}
