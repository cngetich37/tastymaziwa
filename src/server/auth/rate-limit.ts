/**
 * Database-backed sliding-window rate limiting. Works across serverless
 * instances without Redis; fine at a small shop's traffic.
 */
import { and, count, eq, gt, lt } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { rateLimitEvents } from '@/db/schema';

export interface Limit {
  key: string;
  max: number;
  windowSeconds: number;
}

export async function countRecent(tx: Tx, key: string, windowSeconds: number): Promise<number> {
  const since = new Date(Date.now() - windowSeconds * 1000);
  const [row] = await tx
    .select({ n: count() })
    .from(rateLimitEvents)
    .where(and(eq(rateLimitEvents.key, key), gt(rateLimitEvents.createdAt, since)));
  return row?.n ?? 0;
}

export async function recordHit(tx: Tx, key: string): Promise<void> {
  await tx.insert(rateLimitEvents).values({ key });
}

/** True if every limit has room; records a hit against each when it does. */
export async function consume(tx: Tx, limits: Limit[]): Promise<boolean> {
  for (const l of limits) {
    if ((await countRecent(tx, l.key, l.windowSeconds)) >= l.max) return false;
  }
  for (const l of limits) await recordHit(tx, l.key);
  return true;
}

/** Housekeeping: drop events older than a day (called by the daily cron). */
export async function pruneRateLimits(tx: Tx): Promise<void> {
  await tx.delete(rateLimitEvents).where(lt(rateLimitEvents.createdAt, new Date(Date.now() - 86_400_000)));
}

const WINDOW = 15 * 60;

/**
 * Emails per IP per window. Configurable because many people can share one IP
 * (a shop's Wi-Fi, mobile carrier NAT) — and end-to-end tests all come from one.
 */
const emailsPerIp = () => {
  const n = Number(process.env.RATE_LIMIT_EMAILS_PER_IP);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 15;
};

/** Policies, in one place. */
export const limits = {
  /** Emails sent (codes, reset links, sign-up): per address and per IP. */
  sendEmail: (email: string, ip: string): Limit[] => [
    { key: `send:email:${email}`, max: 3, windowSeconds: WINDOW },
    { key: `send:ip:${ip}`, max: emailsPerIp(), windowSeconds: WINDOW },
  ],
  /** Failed password sign-ins: lock the address (not the person) for a while. */
  loginFailures: (email: string): Limit => ({ key: `login-fail:${email}`, max: 5, windowSeconds: WINDOW }),
};
