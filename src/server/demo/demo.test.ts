/**
 * "Try the demo": the sample shop's shape, its sign-in tokens, role
 * switching, what is switched off, tenant isolation and purging.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { createDb, migrateDb, type DB } from '@/db/client';
import { auditLog, ledgerEntries, shops, users } from '@/db/schema';
import { addDays, todayBusinessDate } from '@/lib/dates';
import { expectedTakings } from '@/lib/calc/close';
import { inviteStaff, requestEmailChange } from '../auth/accounts';
import {
  DomainError,
  postPayroll,
  reviewDelivery,
  reviewShiftClose,
  setStockAlertPhone,
  submitShiftClose,
  type Actor,
} from '../ledger';
import { saveMpesaSettings } from '../mpesa/payments';
import { getStockLevels, listCustomers, listDeliverySubmissions, listShiftCloses, listSuppliers } from '../queries';
import { createDemoShop, demoSignInToken, demoSwitchToken, purgeExpiredDemos, startDemo, verifyDemoSignIn } from './demo';
import { DEMO_HISTORY_DAYS } from './data';

let db: DB;
let close: () => Promise<void>;
let demo: { shopId: string; ownerId: string; sellerId: string; supplierUserId: string };
let owner: Actor;
let seller: Actor;
let real: Actor;
const today = todayBusinessDate();

beforeAll(async () => {
  process.env.AUTH_SECRET ??= 'test-secret-for-demo';
  ({ db, close } = await createDb({ pgliteDir: 'memory://' }));
  await migrateDb(db);
  const [shop] = await db.insert(shops).values({ name: 'Real Shop' }).returning();
  const [user] = await db
    .insert(users)
    .values({ shopId: shop.id, name: 'Real Owner', email: 'owner@real.test', passwordHash: 'x', role: 'owner' })
    .returning();
  real = { id: user.id, role: 'owner', shopId: shop.id };

  const started = await startDemo(db, 'ip-main');
  if (typeof started === 'string') throw new Error(`demo did not start: ${started}`);
  const login = await verifyDemoSignIn(db, started.token);
  if (typeof login === 'string') throw new Error('demo token was rejected');
  const logins = await db.select().from(users).where(eq(users.shopId, started.shopId));
  demo = {
    shopId: started.shopId,
    ownerId: login.id,
    sellerId: logins.find((u) => u.role === 'attendant')!.id,
    supplierUserId: logins.find((u) => u.role === 'supplier')!.id,
  };
  owner = { id: demo.ownerId, role: 'owner', shopId: demo.shopId };
  seller = { id: demo.sellerId, role: 'attendant', shopId: demo.shopId };
});

afterAll(() => close());

describe('demo shop data', () => {
  it('fills every module with consistent sample trading', async () => {
    const [shop] = await db.select().from(shops).where(eq(shops.id, demo.shopId));
    expect(shop.demoExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 12 * 3_600_000);
    expect(shop.salePricePerLitreCents).toBe(7000);

    const kinds = await db
      .select({ kind: ledgerEntries.kind, n: sql<number>`count(*)`.mapWith(Number) })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.shopId, demo.shopId))
      .groupBy(ledgerEntries.kind);
    const n = Object.fromEntries(kinds.map((k) => [k.kind, k.n]));
    for (const kind of ['delivery', 'sale', 'customer_payment', 'supplier_payment', 'expense', 'spoilage']) {
      expect(n[kind], kind).toBeGreaterThan(0);
    }
    const [{ first }] = await db
      .select({ first: sql<string>`min(${ledgerEntries.businessDate})::text` })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.shopId, demo.shopId));
    expect(first).toBe(addDays(today, -(DEMO_HISTORY_DAYS - 1)));

    // Stock never goes negative, milk or products.
    const stock = await getStockLevels(db, demo.shopId);
    for (const item of stock) expect(item.onHand, item.name).toBeGreaterThanOrEqual(0);

    // Credit in every state: overdue, partly paid, settled, near the limit.
    const balance = Object.fromEntries((await listCustomers(db, demo.shopId)).map((c) => [c.name, c.balanceCents]));
    expect(balance['Otieno Juma']).toBe(112_000);
    expect(balance['Peter Kamau']).toBe(75_000);
    expect(balance['Grace Muthoni']).toBe(0);
    expect(balance['Watoto Wema Daycare']).toBe(0);
    expect(balance['Tumaini Café']).toBeGreaterThan(0);
    expect(balance['Jane Achieng']).toBeGreaterThanOrEqual(0);

    for (const s of await listSuppliers(db, demo.shopId)) expect(s.payableCents, s.name).toBeGreaterThanOrEqual(0);

    // Things waiting for someone to do.
    expect(await listDeliverySubmissions(db, demo.shopId, { status: 'pending' })).toHaveLength(1);
    expect(await listDeliverySubmissions(db, demo.shopId, { status: 'rejected' })).toHaveLength(1);
    expect(await listShiftCloses(db, demo.shopId, { status: 'submitted' })).toHaveLength(1);
  });

  it('lets each role do its job on the sample data', async () => {
    // The seller approves the milkman's delivery.
    const [pending] = await listDeliverySubmissions(db, demo.shopId, { status: 'pending' });
    await reviewDelivery(db, seller, { submissionId: pending.id, decision: 'approve' });

    // The seller closes today's shift: only today's entries are expected.
    const todays = await db
      .select()
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.shopId, demo.shopId), eq(ledgerEntries.businessDate, today)));
    const closeRow = await submitShiftClose(db, seller, { countedCash: 0, countedMpesa: 0, countedMilk: 0 });
    expect(closeRow.expectedCashCents).toBe(expectedTakings(todays).cashCents);
    expect(closeRow.expectedMpesaCents).toBe(expectedTakings(todays).mpesaCents);

    // The owner signs off yesterday's short close and pays last month's wages.
    const [yesterday] = await listShiftCloses(db, demo.shopId, { status: 'submitted', limit: 5 }).then((c) =>
      c.filter((x) => x.businessDate === addDays(today, -1)),
    );
    await reviewShiftClose(db, owner, { closeId: yesterday.id, writeOffShortfall: true });
    const lastMonth = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
    const run = await postPayroll(db, owner, { month: lastMonth, paymentMethod: 'mpesa' });
    expect(run.netCents).toBeGreaterThan(0);
  });
});

describe('demo sign-in', () => {
  it('accepts a fresh token for a live demo login only', async () => {
    const ok = await verifyDemoSignIn(db, demoSignInToken(demo.sellerId));
    expect(ok).toMatchObject({ id: demo.sellerId, role: 'attendant', shopId: demo.shopId });

    const token = demoSignInToken(demo.ownerId);
    expect(await verifyDemoSignIn(db, `${token.slice(0, -2)}xx`)).toBe('invalid');
    expect(await verifyDemoSignIn(db, demoSignInToken(demo.ownerId, Date.now() - 10 * 60_000))).toBe('invalid');
    expect(await verifyDemoSignIn(db, 'not-a-token')).toBe('invalid');
    // A correctly signed token is still useless for a real shop's user.
    expect(await verifyDemoSignIn(db, demoSignInToken(real.id!))).toBe('invalid');
  });

  it('switches between the demo shop’s own logins, and nowhere else', async () => {
    for (const [role, id] of [
      ['attendant', demo.sellerId],
      ['supplier', demo.supplierUserId],
      ['owner', demo.ownerId],
    ] as const) {
      const login = await verifyDemoSignIn(db, await demoSwitchToken(db, seller, role));
      expect(login).toMatchObject({ id, shopId: demo.shopId });
    }
    await expect(demoSwitchToken(db, real, 'attendant')).rejects.toThrow(DomainError);
  });

  it('rate-limits new demos per IP', async () => {
    process.env.RATE_LIMIT_DEMOS_PER_IP = '1';
    try {
      expect(typeof (await startDemo(db, 'ip-limited'))).toBe('object');
      expect(await startDemo(db, 'ip-limited')).toBe('rate_limited');
    } finally {
      delete process.env.RATE_LIMIT_DEMOS_PER_IP;
    }
  });
});

describe('demo shops stay inside the sandbox', () => {
  it('refuses invites, email changes, M-Pesa and WhatsApp', async () => {
    await expect(inviteStaff(db, owner, { name: 'Pal', email: 'pal@example.com', role: 'attendant' })).rejects.toThrow(
      /switched off in the demo/,
    );
    await expect(requestEmailChange(db, owner, 'me@example.com', 'ip')).rejects.toThrow(/switched off in the demo/);
    await expect(setStockAlertPhone(db, owner, '+254700000999')).rejects.toThrow(/switched off in the demo/);
    await expect(
      saveMpesaSettings(db, owner, {
        environment: 'sandbox',
        shortcodeType: 'paybill',
        businessShortcode: '174379',
        accountReference: 'Demo',
        consumerKey: 'k',
        consumerSecret: 's',
        passkey: 'p',
        enabled: true,
      } as Parameters<typeof saveMpesaSettings>[2]),
    ).rejects.toThrow(/switched off in the demo/);
    // Real shops are unaffected.
    await expect(setStockAlertPhone(db, real, '+254700000999')).resolves.toBeUndefined();
  });

  it('keeps tenant isolation: no demo data in a real shop', async () => {
    expect(await listCustomers(db, real.shopId)).toHaveLength(0);
    expect(await listSuppliers(db, real.shopId)).toHaveLength(0);
  });
});

describe('purging', () => {
  /** Rows per table holding `shop_id`, for one shop. */
  async function rowsFor(shopId: string) {
    const tables = await db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.columns where column_name = 'shop_id' and table_schema = 'public'`,
    );
    const list = (Array.isArray(tables) ? tables : (tables as { rows: { table_name: string }[] }).rows).map((t) => t.table_name);
    let total = 0;
    for (const t of list) {
      const res = await db.execute<{ n: number }>(sql`select count(*)::int as n from ${sql.identifier(t)} where shop_id = ${shopId}`);
      const rows = Array.isArray(res) ? res : (res as { rows: { n: number }[] }).rows;
      total += rows[0].n;
    }
    return { tables: list.length, total };
  }

  it('deletes expired demo shops whole, and nothing else', async () => {
    const expired = await createDemoShop(db, { expiresAt: new Date(Date.now() - 1000) });
    expect((await rowsFor(expired.shopId)).total).toBeGreaterThan(1000);
    const liveBefore = await rowsFor(demo.shopId);
    const realBefore = await rowsFor(real.shopId);

    expect(await purgeExpiredDemos(db)).toBe(1);

    const after = await rowsFor(expired.shopId);
    expect(after.tables).toBeGreaterThan(15);
    expect(after.total).toBe(0);
    expect(await db.select().from(shops).where(eq(shops.id, expired.shopId))).toHaveLength(0);
    expect(await rowsFor(demo.shopId)).toEqual(liveBefore);
    expect(await rowsFor(real.shopId)).toEqual(realBefore);
  });

  /** Drizzle wraps the database error; the trigger's message is the cause. */
  const dbError = (p: Promise<unknown>) =>
    p.then(
      () => 'no error',
      (e: Error) => String((e.cause as Error | undefined)?.message ?? e.message),
    );

  it('keeps the ledger append-only for real and live demo shops', async () => {
    expect(await dbError(db.delete(ledgerEntries).where(eq(ledgerEntries.shopId, demo.shopId)))).toMatch(/append-only/);
    expect(await dbError(db.delete(auditLog).where(eq(auditLog.shopId, real.shopId)))).toMatch(/append-only/);
  });

  it('never lets a real shop become a demo', async () => {
    expect(
      await dbError(db.update(shops).set({ demoExpiresAt: new Date(Date.now() - 1000) }).where(eq(shops.id, real.shopId))),
    ).toMatch(/set once/);
  });
});
