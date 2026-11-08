import { timingSafeEqual } from 'node:crypto';
import { lt, or, isNotNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { authTokens, shops } from '@/db/schema';
import { pruneRateLimits } from '@/server/auth/rate-limit';
import { billSubscriptions, systemActor } from '@/server/ledger';

/**
 * Daily subscription billing for every shop, triggered by Vercel Cron (see
 * vercel.json). Requires `Authorization: Bearer $CRON_SECRET`, which Vercel
 * sends automatically when CRON_SECRET is set on the project. Safe to call
 * repeatedly: each subscription is billed at most once per business day.
 * Also prunes spent auth tokens and old rate-limit events.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 });
  }
  const given = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = await getDb();
  const allShops = await db.select({ id: shops.id }).from(shops);
  const results = [];
  for (const shop of allShops) {
    // One shop's failure must not stop the others from being billed.
    try {
      results.push({ shopId: shop.id, ...(await billSubscriptions(db, systemActor(shop.id))) });
    } catch (error) {
      console.error('[cron] billing failed for shop', shop.id, error);
      results.push({ shopId: shop.id, error: 'billing failed' });
    }
  }

  const dayAgo = new Date(Date.now() - 86_400_000);
  await db.delete(authTokens).where(or(lt(authTokens.expiresAt, dayAgo), isNotNull(authTokens.consumedAt)));
  await pruneRateLimits(db);

  return NextResponse.json({ shops: results.length, results });
}
