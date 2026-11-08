/**
 * Prices and dates are the owner's: attendants record quantities only.
 * These rules live in the services, so they hold whatever the UI sends.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createDb, migrateDb, type DB } from '@/db/client';
import { auditLog, shops, suppliers, users } from '@/db/schema';
import { addDays, todayBusinessDate } from '@/lib/dates';
import {
  createCustomer,
  createSupplier,
  DomainError,
  recordDelivery,
  recordSale,
  setSalePrice,
  updateCustomer,
  updateSupplier,
  type Actor,
} from './ledger';
import { getShop } from './queries';

let db: DB;
let close: () => Promise<void>;
let owner: Actor;
let attendant: Actor;
const today = todayBusinessDate();
const yesterday = addDays(today, -1);

async function makeShop(name: string) {
  const [shop] = await db.insert(shops).values({ name }).returning();
  const [o] = await db
    .insert(users)
    .values({ shopId: shop.id, name: 'Owner', email: `owner@${shop.id}.test`, passwordHash: 'x', role: 'owner' })
    .returning();
  const [a] = await db
    .insert(users)
    .values({ shopId: shop.id, name: 'Attendant', email: `att@${shop.id}.test`, passwordHash: 'x', role: 'attendant' })
    .returning();
  return {
    owner: { id: o.id, role: 'owner', shopId: shop.id } satisfies Actor,
    attendant: { id: a.id, role: 'attendant', shopId: shop.id } satisfies Actor,
  };
}

beforeAll(async () => {
  ({ db, close } = await createDb({ pgliteDir: 'memory://' }));
  await migrateDb(db);
  ({ owner, attendant } = await makeShop('Price Shop'));
});

afterAll(() => close());

describe('selling price', () => {
  it('blocks attendant sales until the owner sets a price', async () => {
    await expect(recordSale(db, attendant, { litres: 1000, paymentMethod: 'cash' })).rejects.toThrow(
      'The owner has not set a selling price yet',
    );
  });

  it('records attendant sales at the price on file', async () => {
    await setSalePrice(db, owner, 7000);
    const sale = await recordSale(db, attendant, { litres: 2500, paymentMethod: 'cash' });
    expect(sale.unitPriceCents).toBe(7000);
    expect(sale.amountCents).toBe(17_500);
  });

  it('rejects an attendant price that differs from the price on file', async () => {
    await expect(
      recordSale(db, attendant, { litres: 1000, pricePerLitre: 5000, paymentMethod: 'cash' }),
    ).rejects.toThrow('Only the owner can change prices');
    // Sending the same price is harmless.
    const same = await recordSale(db, attendant, { litres: 1000, pricePerLitre: 7000, paymentMethod: 'mpesa' });
    expect(same.unitPriceCents).toBe(7000);
  });

  it('lets the owner override the price for one sale', async () => {
    const sale = await recordSale(db, owner, { litres: 1000, pricePerLitre: 6000, paymentMethod: 'cash' });
    expect(sale.unitPriceCents).toBe(6000);
    // The price on file is unchanged.
    expect((await getShop(db, owner.shopId))?.salePricePerLitreCents).toBe(7000);
  });

  it('audits price changes with the old and new price', async () => {
    await setSalePrice(db, owner, 7500);
    const rows = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.shopId, owner.shopId), eq(auditLog.action, 'shop.sale_price')));
    expect(rows.at(-1)?.data).toEqual({ from: 7000, to: 7500 });
    const sale = await recordSale(db, attendant, { litres: 1000, paymentMethod: 'cash' });
    expect(sale.unitPriceCents).toBe(7500);
  });
});

describe('supplier price', () => {
  it("records attendant deliveries at the supplier's agreed price", async () => {
    const s = await createSupplier(db, owner, { name: 'Kamau', defaultPricePerLitre: 5000 });
    const d = await recordDelivery(db, attendant, { supplierId: s.id, litres: 40_000 });
    expect(d.unitPriceCents).toBe(5000);
    expect(d.amountCents).toBe(200_000);
    await expect(
      recordDelivery(db, attendant, { supplierId: s.id, litres: 1000, pricePerLitre: 4000 }),
    ).rejects.toThrow('Only the owner can change prices');
  });

  it('asks for a price when the supplier has none', async () => {
    const s = await createSupplier(db, owner, { name: 'New Milkman' });
    await expect(recordDelivery(db, attendant, { supplierId: s.id, litres: 1000 })).rejects.toThrow(
      "The owner has not set New Milkman's price per litre yet",
    );
    // The owner can still record it by typing the price.
    const d = await recordDelivery(db, owner, { supplierId: s.id, litres: 1000, pricePerLitre: 4800 });
    expect(d.unitPriceCents).toBe(4800);
  });

  it('updates the agreed price and audits the previous one', async () => {
    const s = await createSupplier(db, owner, { name: 'Wanjiru', defaultPricePerLitre: 5000 });
    await updateSupplier(db, owner, { supplierId: s.id, name: 'Wanjiru', defaultPricePerLitre: 5200 });
    const d = await recordDelivery(db, attendant, { supplierId: s.id, litres: 1000 });
    expect(d.unitPriceCents).toBe(5200);
    const [row] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, s.id), eq(auditLog.action, 'supplier.update')));
    expect(row.data).toMatchObject({ previousPricePerLitreCents: 5000, defaultPricePerLitre: 5200 });
  });
});

describe('entry dates', () => {
  it('only lets the owner record for another day', async () => {
    await expect(recordSale(db, attendant, { litres: 1000, paymentMethod: 'cash', date: yesterday })).rejects.toThrow(
      'Only the owner can record entries for another day',
    );
    const sale = await recordSale(db, owner, { litres: 1000, paymentMethod: 'cash', date: yesterday });
    expect(sale.businessDate).toBe(yesterday);
    // Today's date, sent explicitly, is fine for anyone.
    const todays = await recordSale(db, attendant, { litres: 1000, paymentMethod: 'cash', date: today });
    expect(todays.businessDate).toBe(today);
  });
});

describe('tenant isolation', () => {
  it("can't edit another shop's customers or suppliers", async () => {
    const other = await makeShop('Other Shop');
    const customer = await createCustomer(db, owner, { name: 'Jane' });
    const [supplier] = await db.select().from(suppliers).where(eq(suppliers.shopId, owner.shopId)).limit(1);

    await expect(updateCustomer(db, other.owner, { customerId: customer.id, name: 'Hacked' })).rejects.toBeInstanceOf(
      DomainError,
    );
    await expect(
      updateSupplier(db, other.owner, { supplierId: supplier.id, name: 'Hacked', defaultPricePerLitre: 1 }),
    ).rejects.toBeInstanceOf(DomainError);

    // Setting a price in one shop leaves the other's alone.
    await setSalePrice(db, other.owner, 9900);
    expect((await getShop(db, owner.shopId))?.salePricePerLitreCents).toBe(7500);
    expect((await getShop(db, other.owner.shopId))?.salePricePerLitreCents).toBe(9900);
  });
});
