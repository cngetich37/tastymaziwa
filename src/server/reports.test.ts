import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, migrateDb, type DB } from '@/db/client';
import { shops, users } from '@/db/schema';
import { resolveRange } from '@/lib/calc/reports';
import { addDays, todayBusinessDate } from '@/lib/dates';
import { REPORT_TYPES } from '@/lib/validation';
import {
  createCustomer,
  createSupplier,
  recordExpense,
  recordSale,
  reverseEntry,
  reviewDelivery,
  setSalePrice,
  submitDelivery,
  type Actor,
} from './ledger';
import { getReport } from './reports';

let db: DB;
let close: () => Promise<void>;
const today = todayBusinessDate();
const range = resolveRange({ range: '7d' }, today);

async function makeShop(name: string) {
  const [shop] = await db.insert(shops).values({ name }).returning();
  const [o] = await db
    .insert(users)
    .values({ shopId: shop.id, name: `${name} Owner`, email: `o@${shop.id}.test`, passwordHash: 'x', role: 'owner' })
    .returning();
  const [s] = await db
    .insert(users)
    .values({ shopId: shop.id, name: `${name} Seller`, email: `s@${shop.id}.test`, passwordHash: 'x', role: 'attendant' })
    .returning();
  const owner: Actor = { id: o.id, role: 'owner', shopId: shop.id };
  const seller: Actor = { id: s.id, role: 'attendant', shopId: shop.id };
  const supplier = await createSupplier(db, owner, { name: `${name} Milkman`, defaultPricePerLitre: 5000 });
  const [m] = await db
    .insert(users)
    .values({ shopId: shop.id, name: 'Milkman', email: `m@${shop.id}.test`, role: 'supplier', supplierId: supplier.id })
    .returning();
  const milkman: Actor = { id: m.id, role: 'supplier', shopId: shop.id };
  await setSalePrice(db, owner, 7000);
  return { shopId: shop.id, owner, seller, milkman };
}

let a: Awaited<ReturnType<typeof makeShop>>;
let b: Awaited<ReturnType<typeof makeShop>>;

beforeAll(async () => {
  ({ db, close } = await createDb({ pgliteDir: 'memory://' }));
  await migrateDb(db);
  a = await makeShop('A');
  b = await makeShop('B');

  // Shop A: 20 L delivered and approved, one rejected, 10 L sold (one sale reversed), an expense, a debt.
  const ok = await submitDelivery(db, a.milkman, { litres: 20_000 });
  await reviewDelivery(db, a.seller, { submissionId: ok.id, decision: 'approve' });
  const bad = await submitDelivery(db, a.milkman, { litres: 30_000 });
  await reviewDelivery(db, a.seller, { submissionId: bad.id, decision: 'reject', reason: 'Short' });
  await recordSale(db, a.seller, { litres: 8000, paymentMethod: 'cash' });
  const jane = await createCustomer(db, a.owner, { name: 'Jane' });
  await recordSale(db, a.owner, {
    litres: 2000,
    paymentMethod: 'credit',
    customerId: jane.id,
    date: addDays(today, -5),
    dueDate: addDays(today, -3),
  });
  const mistake = await recordSale(db, a.seller, { litres: 5000, paymentMethod: 'mpesa' });
  await reverseEntry(db, a.owner, mistake.id, 'typo');
  await recordExpense(db, a.owner, { amount: 10_000, category: 'transport' });

  // Shop B trades too, and must never show up in A's reports.
  const bOk = await submitDelivery(db, b.milkman, { litres: 99_000 });
  await reviewDelivery(db, b.seller, { submissionId: bOk.id, decision: 'approve' });
  await recordSale(db, b.seller, { litres: 50_000, paymentMethod: 'cash' });
});

afterAll(() => close());

const stat = (report: Awaited<ReturnType<typeof getReport>>, label: string) =>
  report.stats.find((s) => s.label === label)?.value;

describe('reports', () => {
  it('computes profit and loss from the ledger, reversals cancelled', async () => {
    const r = await getReport(db, a.shopId, 'profit', range);
    expect(stat(r, 'Sales')).toBe(70_000); // 10 L × 70
    expect(stat(r, 'Cost of milk')).toBe(100_000); // 20 L × 50
    expect(stat(r, 'Expenses')).toBe(10_000);
    expect(stat(r, 'Net profit')).toBe(-40_000);
    expect(stat(r, 'Margin per litre')).toBe(2000);
    expect(r.tables[0].totals).toMatchObject({ soldMl: 10_000, net: -40_000 });
  });

  it('splits sales by payment method', async () => {
    const r = await getReport(db, a.shopId, 'sales', range);
    expect(r.tables[0].totals).toMatchObject({ cash: 56_000, credit: 14_000, mpesa: 0, total: 70_000 });
  });

  it('counts only approved deliveries as received, and shows the rest', async () => {
    const r = await getReport(db, a.shopId, 'deliveries', range);
    expect(r.tables[0].rows).toEqual([
      expect.objectContaining({ name: 'A Milkman', deliveries: 1, volumeMl: 20_000, amount: 100_000, rejected: 1, pending: 0 }),
    ]);
    const approvals = await getReport(db, a.shopId, 'approvals', range);
    expect(approvals.tables[0].rows.map((row) => row.status).sort()).toEqual(['approved', 'rejected']);
    expect(approvals.tables[0].rows.find((row) => row.status === 'rejected')).toMatchObject({
      reviewedBy: 'A Seller',
      reason: 'Short',
    });
  });

  it('ages debts and balances suppliers', async () => {
    const debtors = await getReport(db, a.shopId, 'debtors', range);
    expect(debtors.tables[0].rows).toEqual([expect.objectContaining({ name: 'Jane', d1_7: 14_000, total: 14_000 })]);
    const sup = await getReport(db, a.shopId, 'suppliers', range);
    expect(sup.tables[0].totals).toMatchObject({ owed: 100_000, bought: 100_000, paid: 0 });
  });

  it('credits each person with what they recorded and approved', async () => {
    const r = await getReport(db, a.shopId, 'staff', range);
    expect(r.tables[0].rows.find((row) => row.name === 'A Seller')).toMatchObject({
      sales: 1, // the reversed sale isn't counted, but shows as corrected
      reversed: 1,
      soldMl: 8000,
      approved: 1,
      rejected: 1,
    });
    expect(r.tables[0].rows.some((row) => row.name === 'Milkman')).toBe(false);
  });

  it("never includes another shop's data", async () => {
    for (const type of REPORT_TYPES) {
      const json = JSON.stringify(await getReport(db, a.shopId, type, range));
      expect(json).not.toContain('B Milkman');
      expect(json).not.toContain('B Seller');
      expect(json).not.toContain('99000');
    }
    const bProfit = await getReport(db, b.shopId, 'profit', range);
    expect(stat(bProfit, 'Sales')).toBe(350_000);
  });
});
