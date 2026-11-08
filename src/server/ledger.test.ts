/**
 * Integration tests: real Postgres (PGlite, in memory) with the real
 * migrations, so constraints, triggers and SQL aggregates are exercised.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createDb, migrateDb, type DB } from '@/db/client';
import { auditLog, ledgerEntries, users } from '@/db/schema';
import { todayBusinessDate, addDays } from '@/lib/dates';
import {
  billSubscriptions,
  createCustomer,
  createSubscription,
  createSupplier,
  DomainError,
  recordCustomerPayment,
  recordDelivery,
  recordExpense,
  recordSale,
  recordSpoilage,
  reverseEntry,
  type Actor,
} from './ledger';
import { getDashboard, getOutstandingCredit, listCustomers, listEntries, listSuppliers } from './queries';

let db: DB;
let close: () => Promise<void>;
let actor: Actor;
const today = todayBusinessDate();

beforeAll(async () => {
  ({ db, close } = await createDb({ pgliteDir: 'memory://' }));
  await migrateDb(db);
  const [user] = await db
    .insert(users)
    .values({ name: 'Owner', username: 'owner', passwordHash: 'x', role: 'owner' })
    .returning();
  actor = { id: user.id, role: 'owner' };
});

afterAll(() => close());

describe('ledger services', () => {
  it('records a day of trading and derives every figure from the ledger', async () => {
    const supplier = await createSupplier(db, actor, { name: 'Milkman Kamau', defaultPricePerLitre: 5000 });
    const jane = await createCustomer(db, actor, { name: 'Jane', phone: '+254712345678' });

    await recordDelivery(db, actor, { supplierId: supplier.id, litres: 50_000, pricePerLitre: 5000 });
    await recordSale(db, actor, { litres: 20_000, pricePerLitre: 7000, paymentMethod: 'cash' });
    await recordSale(db, actor, { litres: 10_000, pricePerLitre: 7000, paymentMethod: 'mpesa' });
    await recordSale(db, actor, {
      litres: 5_000,
      pricePerLitre: 7000,
      paymentMethod: 'credit',
      customerId: jane.id,
    });
    await recordSpoilage(db, actor, { litres: 1_500, reason: 'sour' });
    await recordExpense(db, actor, { category: 'transport', amount: 20_000 });
    await recordCustomerPayment(db, actor, { customerId: jane.id, amount: 10_000, paymentMethod: 'mpesa' });

    const dash = await getDashboard(db, today);
    expect(dash.todaySummary.salesCents).toBe(245_000);
    expect(dash.todaySummary.grossProfitCents).toBe(245_000 - 250_000);
    expect(dash.todaySummary.netProfitCents).toBe(245_000 - 250_000 - 20_000);
    expect(dash.stockOnHandMl).toBe(50_000 - 35_000 - 1_500);
    expect(dash.receivablesCents).toBe(35_000 - 10_000);
    expect(dash.payablesCents).toBe(250_000);
    expect(dash.series).toHaveLength(7);
    expect(dash.series.at(-1)?.salesCents).toBe(245_000);

    const [customer] = await listCustomers(db);
    expect(customer.balanceCents).toBe(25_000);

    const [sup] = await listSuppliers(db);
    expect(sup.payableCents).toBe(250_000);

    const outstanding = await getOutstandingCredit(db, today);
    expect(outstanding).toHaveLength(1);
    expect(outstanding[0]).toMatchObject({ status: 'partial', outstandingCents: 25_000, customerName: 'Jane' });
    expect(outstanding[0].dueDate).toBe(addDays(today, 7));
  });

  it('writes an audit row for every change', async () => {
    const [{ entries }] = await db.select({ entries: sql<number>`count(*)`.mapWith(Number) }).from(ledgerEntries);
    const [{ audits }] = await db
      .select({ audits: sql<number>`count(*)`.mapWith(Number) })
      .from(auditLog)
      .where(sql`${auditLog.action} like 'ledger.%'`);
    expect(audits).toBe(entries);
  });

  it('rejects a credit sale without a customer at the database level', async () => {
    await expect(
      db.insert(ledgerEntries).values({
        kind: 'sale',
        businessDate: today,
        amountCents: 100,
        paymentMethod: 'credit',
      }),
    ).rejects.toThrow();
  });

  it('refuses to update or delete ledger rows', async () => {
    const [entry] = await db.select().from(ledgerEntries).limit(1);
    await expect(
      db.update(ledgerEntries).set({ amountCents: 1 }).where(eq(ledgerEntries.id, entry.id)),
    ).rejects.toThrow();
    await expect(db.delete(ledgerEntries).where(eq(ledgerEntries.id, entry.id))).rejects.toThrow();
  });
});

describe('reversals', () => {
  it('cancels an entry exactly once', async () => {
    const before = await getDashboard(db, today);
    const sale = await recordSale(db, actor, { litres: 3_000, pricePerLitre: 7000, paymentMethod: 'cash' });
    const reversal = await reverseEntry(db, actor, sale.id, 'Typed wrong amount');

    expect(reversal.amountCents).toBe(-sale.amountCents);
    expect(reversal.businessDate).toBe(sale.businessDate);
    const after = await getDashboard(db, today);
    expect(after.todaySummary.salesCents).toBe(before.todaySummary.salesCents);
    expect(after.stockOnHandMl).toBe(before.stockOnHandMl);

    await expect(reverseEntry(db, actor, sale.id, 'again')).rejects.toBeInstanceOf(DomainError);
    await expect(reverseEntry(db, actor, reversal.id, 'meta')).rejects.toBeInstanceOf(DomainError);

    const rows = await listEntries(db, { limit: 5 });
    expect(rows.find((r) => r.id === sale.id)?.reversedById).toBe(reversal.id);
  });

  it('removes a reversed credit sale from outstanding credit', async () => {
    const [jane] = await listCustomers(db);
    const sale = await recordSale(db, actor, {
      litres: 1_000,
      pricePerLitre: 7000,
      paymentMethod: 'credit',
      customerId: jane.id,
    });
    expect((await getOutstandingCredit(db, today)).some((c) => c.id === sale.id)).toBe(true);
    await reverseEntry(db, actor, sale.id, 'Wrong customer');
    expect((await getOutstandingCredit(db, today)).some((c) => c.id === sale.id)).toBe(false);
  });
});

describe('subscription billing', () => {
  it('bills each active subscription once per day, however often it runs', async () => {
    const mama = await createCustomer(db, actor, { name: 'Mama Wanjiku' });
    await createSubscription(db, actor, {
      customerId: mama.id,
      dailyLitres: 2_000,
      pricePerLitre: 6500,
      startDate: addDays(today, -1),
    });
    await createSubscription(db, actor, {
      customerId: mama.id,
      dailyLitres: 1_000,
      pricePerLitre: 6500,
      startDate: addDays(today, 1), // not started yet
    });

    const first = await billSubscriptions(db, actor, today);
    const second = await billSubscriptions(db, actor, today);
    expect(first).toMatchObject({ active: 1, billed: 1, volumeMl: 2_000, amountCents: 13_000 });
    expect(second.billed).toBe(0);

    const customers = await listCustomers(db);
    expect(customers.find((c) => c.id === mama.id)?.balanceCents).toBe(13_000);
  });
});
