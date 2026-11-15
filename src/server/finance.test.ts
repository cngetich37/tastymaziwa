/** Finance: credit limits, supplier payment runs, statements and budgets. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, migrateDb, type DB } from '@/db/client';
import { shops, users } from '@/db/schema';
import { addDays, todayBusinessDate } from '@/lib/dates';
import {
  createCustomer,
  createSupplier,
  paySuppliers,
  recordCustomerPayment,
  recordDelivery,
  recordExpense,
  recordSale,
  setBudgets,
  setSalePrice,
  updateCustomer,
  type Actor,
} from './ledger';
import { getExpenseBreakdown, getPeriodStatement, listSuppliers } from './queries';

let db: DB;
let close: () => Promise<void>;
const today = todayBusinessDate();

async function makeShop(name: string) {
  const [shop] = await db.insert(shops).values({ name }).returning();
  const [o] = await db
    .insert(users)
    .values({ shopId: shop.id, name: 'Owner', email: `o@${shop.id}.test`, passwordHash: 'x', role: 'owner' })
    .returning();
  const [s] = await db
    .insert(users)
    .values({ shopId: shop.id, name: 'Seller', email: `s@${shop.id}.test`, passwordHash: 'x', role: 'attendant' })
    .returning();
  const owner: Actor = { id: o.id, role: 'owner', shopId: shop.id };
  const seller: Actor = { id: s.id, role: 'attendant', shopId: shop.id };
  await setSalePrice(db, owner, 7000);
  return { shopId: shop.id, owner, seller };
}

let a: Awaited<ReturnType<typeof makeShop>>;
let b: Awaited<ReturnType<typeof makeShop>>;

beforeAll(async () => {
  ({ db, close } = await createDb({ pgliteDir: 'memory://' }));
  await migrateDb(db);
  a = await makeShop('A');
  b = await makeShop('B');
});

afterAll(() => close());

describe('credit limits', () => {
  it("stops a seller's credit sale past the limit, but not the owner's", async () => {
    const jane = await createCustomer(db, a.owner, { name: 'Jane', creditLimit: 20_000 });
    await recordSale(db, a.seller, { litres: 2000, paymentMethod: 'credit', customerId: jane.id }); // owes 140
    await expect(
      recordSale(db, a.seller, { litres: 1000, paymentMethod: 'credit', customerId: jane.id }),
    ).rejects.toThrow(/Jane would owe Ksh.210, over their limit of Ksh.200/);
    // Cash sales are never limited, and a payment frees room.
    await recordSale(db, a.seller, { litres: 1000, paymentMethod: 'cash', customerId: jane.id });
    await recordCustomerPayment(db, a.owner, { customerId: jane.id, amount: 14_000, paymentMethod: 'mpesa' });
    await recordSale(db, a.seller, { litres: 2000, paymentMethod: 'credit', customerId: jane.id });
    // The owner may go over (a manager override).
    await recordSale(db, a.owner, { litres: 5000, paymentMethod: 'credit', customerId: jane.id });
    // Lifting the limit lets the seller sell on credit again.
    await updateCustomer(db, a.owner, { customerId: jane.id, name: 'Jane' });
    await recordSale(db, a.seller, { litres: 1000, paymentMethod: 'credit', customerId: jane.id });
  });
});

describe('statements', () => {
  it('brings the balance forward into the period', async () => {
    const tom = await createCustomer(db, a.owner, { name: 'Tom' });
    await recordSale(db, a.owner, {
      litres: 1000,
      paymentMethod: 'credit',
      customerId: tom.id,
      date: addDays(today, -10),
    });
    await recordSale(db, a.owner, { litres: 2000, paymentMethod: 'credit', customerId: tom.id });
    await recordCustomerPayment(db, a.owner, { customerId: tom.id, amount: 10_000, paymentMethod: 'cash' });
    const s = await getPeriodStatement(db, a.shopId, { customerId: tom.id }, addDays(today, -2), today);
    expect(s).toMatchObject({ openingCents: 7000, chargesCents: 14_000, paymentsCents: 10_000, closingCents: 11_000 });
    expect(s.lines).toHaveLength(2);
  });
});

describe('supplier payment runs', () => {
  it('pays several suppliers once, however often the run is sent', async () => {
    const s1 = await createSupplier(db, a.owner, { name: 'Kamau', defaultPricePerLitre: 5000 });
    const s2 = await createSupplier(db, a.owner, { name: 'Wanjiru', defaultPricePerLitre: 5000 });
    await recordDelivery(db, a.owner, { supplierId: s1.id, litres: 10_000 });
    await recordDelivery(db, a.owner, { supplierId: s2.id, litres: 4000 });
    const run = {
      runKey: randomUUID(),
      paymentMethod: 'mpesa' as const,
      lines: [
        { supplierId: s1.id, amount: 50_000 },
        { supplierId: s2.id, amount: 10_000 },
      ],
    };
    expect(await paySuppliers(db, a.owner, run)).toEqual({ paid: 2, totalCents: 60_000 });
    expect(await paySuppliers(db, a.owner, run)).toEqual({ paid: 0, totalCents: 0 });
    const payables = Object.fromEntries((await listSuppliers(db, a.shopId)).map((s) => [s.name, s.payableCents]));
    expect(payables).toMatchObject({ Kamau: 0, Wanjiru: 10_000 });

    await expect(paySuppliers(db, a.seller, { ...run, runKey: randomUUID() })).rejects.toThrow('Only the owner');
    await expect(
      paySuppliers(db, a.owner, { ...run, runKey: randomUUID(), lines: [run.lines[0], run.lines[0]] }),
    ).rejects.toThrow('only appear once');
  });
});

describe('budgets', () => {
  it('sets, updates and clears monthly budgets, and totals spending', async () => {
    await setBudgets(db, a.owner, { budgets: [{ category: 'transport', monthly: 50_000 }, { category: 'rent', monthly: 100_000 }] });
    await setBudgets(db, a.owner, { budgets: [{ category: 'transport', monthly: 60_000 }, { category: 'rent' }] });
    await recordExpense(db, a.owner, { category: 'transport', amount: 12_000, paymentMethod: 'mpesa' });
    const { spent, budgets } = await getExpenseBreakdown(db, a.shopId, today, today);
    expect(spent.get('transport')).toBe(12_000);
    expect([...budgets]).toEqual([['transport', 60_000]]);
    await expect(setBudgets(db, a.seller, { budgets: [] })).rejects.toThrow('Only the owner');
  });
});

describe('tenant isolation', () => {
  it("never pays another shop's supplier or shows its budgets and statements", async () => {
    const [aSupplier] = await listSuppliers(db, a.shopId);
    await expect(
      paySuppliers(db, b.owner, {
        runKey: randomUUID(),
        paymentMethod: 'cash',
        lines: [{ supplierId: aSupplier.id, amount: 100 }],
      }),
    ).rejects.toThrow('Supplier not found');
    const { spent, budgets } = await getExpenseBreakdown(db, b.shopId, today, today);
    expect(spent.size).toBe(0);
    expect(budgets.size).toBe(0);
    const s = await getPeriodStatement(db, b.shopId, { supplierId: aSupplier.id }, addDays(today, -30), today);
    expect(s.lines).toHaveLength(0);
  });
});
