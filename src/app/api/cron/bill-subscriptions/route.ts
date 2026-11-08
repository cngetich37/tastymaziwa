import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { billSubscriptions, SYSTEM_ACTOR } from '@/server/ledger';

/**
 * Daily subscription billing for a scheduler (Cloud Scheduler, Vercel Cron…).
 * Requires `Authorization: Bearer $CRON_SECRET`. Safe to call repeatedly:
 * each subscription is billed at most once per business day.
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

  const result = await billSubscriptions(await getDb(), SYSTEM_ACTOR);
  return NextResponse.json(result);
}
