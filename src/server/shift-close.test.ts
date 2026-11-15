/** End-of-shift close: blind count by the seller, sign-off by the owner. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, migrateDb, type DB } from '@/db/client';
import { shops, users } from '@/db/schema';
import {
  createCustomer,
  createSupplier,
  recordCustomerPayment,
  recordDelivery,
  recordExpense,
  recordSale,
  recordSupplierPayment,
  reviewShiftClose,
  setSalePrice,
  submitShiftClose,
  type Actor,
} from './ledger';
import { getStockOnHandMl, listShiftCloses } from './queries';

let db: DB;
let close: () => Promise<void>;

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
  const supplier = await createSupplier(db, owner, { name: 'Milkman', defaultPricePerLitre: 5000 });
  await setSalePrice(db, owner, 7000);
  return { shopId: shop.id, owner, seller, supplierId: supplier.id };
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

describe('shift close', () => {
  it('snapshots expected cash, M-Pesa and milk for the shift', async () => {
    const jane = await createCustomer(db, a.owner, { name: 'Jane' });
    await recordDelivery(db, a.seller, { supplierId: a.supplierId, litres: 20_000 });
    await recordSale(db, a.seller, { litres: 5000, paymentMethod: 'cash' }); // +350 cash
    await recordSale(db, a.seller, { litres: 2000, paymentMethod: 'mpesa' }); // +140 M-Pesa
    await recordSale(db, a.seller, { litres: 1000, paymentMethod: 'credit', customerId: jane.id }); // no money
    await recordCustomerPayment(db, a.owner, { customerId: jane.id, amount: 5000, paymentMethod: 'cash' }); // +50
    await recordSupplierPayment(db, a.owner, { supplierId: a.supplierId, amount: 10_000, paymentMethod: 'cash' }); // -100
    await recordExpense(db, a.owner, { category: 'transport', amount: 2000 }); // -20, cash by default

    const c = await submitShiftClose(db, a.seller, {
      openingFloat: 50_000,
      countedCash: 77_000,
      countedMpesa: 14_000,
      countedMilk: 11_000,
    });
    expect(c.expectedCashCents).toBe(50_000 + 35_000 + 5000 - 10_000 - 2000);
    expect(c.expectedMpesaCents).toBe(14_000);
    expect(c.expectedMilkMl).toBe(12_000);
    expect(c.status).toBe('submitted');
    expect(c.periodStart).toBeNull();
  });

  it('starts the next shift where the last one ended', async () => {
    await recordSale(db, a.seller, { litres: 1000, paymentMethod: 'cash' });
    const next = await submitShiftClose(db, a.seller, { countedCash: 7000, countedMpesa: 0, countedMilk: 11_000 });
    expect(next.expectedCashCents).toBe(7000);
    expect(next.expectedMpesaCents).toBe(0);
    expect(next.periodStart).not.toBeNull();
  });

  it('lets the owner sign off and write a milk shortfall off as spoilage', async () => {
    const [latest, first] = await listShiftCloses(db, a.shopId);
    expect(first.closedByName).toBe('A Seller');
    await expect(reviewShiftClose(db, a.seller, { closeId: first.id, writeOffShortfall: false })).rejects.toThrow(
      'Only the owner',
    );
    const before = await getStockOnHandMl(db, a.shopId);
    const signed = await reviewShiftClose(db, a.owner, { closeId: first.id, writeOffShortfall: true, note: 'Spill' });
    expect(signed.status).toBe('approved');
    expect(signed.spoilageEntryId).not.toBeNull();
    expect(await getStockOnHandMl(db, a.shopId)).toBe(before - 1000);
    await expect(reviewShiftClose(db, a.owner, { closeId: first.id, writeOffShortfall: false })).rejects.toThrow(
      'already signed off',
    );
    // The latest close matched the stock exactly: nothing to write off.
    await expect(reviewShiftClose(db, a.owner, { closeId: latest.id, writeOffShortfall: true })).rejects.toThrow(
      'no milk shortfall',
    );
    expect((await reviewShiftClose(db, a.owner, { closeId: latest.id, writeOffShortfall: false })).status).toBe(
      'approved',
    );
  });
});

describe('tenant isolation', () => {
  it("never shows or signs off another shop's closes", async () => {
    const [closeA] = await listShiftCloses(db, a.shopId);
    expect(await listShiftCloses(db, b.shopId)).toHaveLength(0);
    await expect(reviewShiftClose(db, b.owner, { closeId: closeA.id, writeOffShortfall: false })).rejects.toThrow(
      'Shift close not found',
    );
    // B's first close only sees B's own (empty) day.
    const bClose = await submitShiftClose(db, b.seller, { countedCash: 0, countedMpesa: 0, countedMilk: 0 });
    expect(bClose).toMatchObject({ expectedCashCents: 0, expectedMpesaCents: 0, expectedMilkMl: 0 });
  });
});
