/**
 * WhatsApp stock updates: which ledger entries message the owner, what they
 * say, and that one shop's entries never reach another shop's number.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createDb, migrateDb, type DB } from '@/db/client';
import { auditLog, shops, users } from '@/db/schema';
import {
  createProduct,
  createSupplier,
  recordDelivery,
  recordSale,
  recordSpoilage,
  reverseEntry,
  setSalePrice,
  setStockAlertPhone,
  DomainError,
  type Actor,
} from '../ledger';
import { notifyStockChange, type Send } from './stock-alerts';

let db: DB;
let close: () => Promise<void>;

async function makeShop(name: string) {
  const [shop] = await db.insert(shops).values({ name }).returning();
  const insertUser = async (role: 'owner' | 'attendant') => {
    const [u] = await db
      .insert(users)
      .values({ shopId: shop.id, name: role, email: `${role}@${shop.id}.test`, passwordHash: 'x', role })
      .returning();
    return { id: u.id, role, shopId: shop.id } satisfies Actor;
  };
  const owner = await insertUser('owner');
  const seller = await insertUser('attendant');
  const supplier = await createSupplier(db, owner, { name: 'Kamau', defaultPricePerLitre: 5000 });
  await setSalePrice(db, owner, 7000);
  return { shopId: shop.id, owner, seller, supplierId: supplier.id };
}

let a: Awaited<ReturnType<typeof makeShop>>;
let b: Awaited<ReturnType<typeof makeShop>>;
const send = vi.fn<Send>(async () => 'sent');

beforeAll(async () => {
  ({ db, close } = await createDb({ pgliteDir: 'memory://' }));
  await migrateDb(db);
  a = await makeShop('Shop A');
  b = await makeShop('Shop B');
  await setStockAlertPhone(db, a.owner, '+254711111111');
  await setStockAlertPhone(db, b.owner, '+254722222222');
});

afterAll(() => close());
beforeEach(() => send.mockClear());

describe('notifyStockChange', () => {
  it('messages the owner when milk is received', async () => {
    const entry = await recordDelivery(db, a.seller, { supplierId: a.supplierId, litres: 40_000 });
    const text = await notifyStockChange(db, a.shopId, entry.id, send);
    expect(text).toBe('40 L of fresh milk received from Kamau. Stock now 40 L.');
    expect(send).toHaveBeenCalledWith({
      to: '+254711111111',
      template: 'stock_update',
      language: 'en',
      params: ['Shop A', text],
    });
  });

  it('messages the owner about write-offs and cancellations', async () => {
    const spoilt = await recordSpoilage(db, a.owner, { litres: 2_000, reason: 'sour' });
    expect(await notifyStockChange(db, a.shopId, spoilt.id, send)).toBe(
      '2 L of fresh milk written off (sour). Stock now 38 L.',
    );
    const reversal = await reverseEntry(db, a.owner, spoilt.id, 'Counted wrong');
    expect(await notifyStockChange(db, a.shopId, reversal.id, send)).toBe(
      'A write-off of 2 L of fresh milk was cancelled. Stock now 40 L.',
    );
  });

  it('stays quiet for ordinary sales, and speaks when a product runs low', async () => {
    const sale = await recordSale(db, a.seller, { litres: 1_000, paymentMethod: 'cash' });
    expect(await notifyStockChange(db, a.shopId, sale.id, send)).toBeNull();

    const mala = await createProduct(db, a.owner, { name: 'Mala', unit: 'litre', salePrice: 10000, costPrice: 6000, reorderLevel: 5_000 });
    await recordDelivery(db, a.owner, { supplierId: a.supplierId, productId: mala.id, litres: 8_000 });
    const first = await recordSale(db, a.seller, { litres: 3_000, productId: mala.id, paymentMethod: 'cash' });
    expect(await notifyStockChange(db, a.shopId, first.id, send)).toBe('Mala is running low: 5 L left (reorder at 5 L).');
    const second = await recordSale(db, a.seller, { litres: 1_000, productId: mala.id, paymentMethod: 'cash' });
    expect(await notifyStockChange(db, a.shopId, second.id, send)).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('sends nothing when the shop has no number set', async () => {
    await setStockAlertPhone(db, b.owner, null);
    const entry = await recordDelivery(db, b.seller, { supplierId: b.supplierId, litres: 10_000 });
    expect(await notifyStockChange(db, b.shopId, entry.id, send)).toBeNull();
    expect(send).not.toHaveBeenCalled();
    await setStockAlertPhone(db, b.owner, '+254722222222');
  });

  it('audits number changes, and only the owner may change it', async () => {
    const rows = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.shopId, a.shopId), eq(auditLog.action, 'shop.stock_alert_whatsapp')));
    expect(rows.map((r) => r.data)).toContainEqual({ from: null, to: '+254711111111' });
    await expect(setStockAlertPhone(db, a.seller, '+254733333333')).rejects.toBeInstanceOf(DomainError);
  });
});

describe('tenant isolation', () => {
  it("never sends one shop's entry to another shop's number", async () => {
    const entry = await recordDelivery(db, a.seller, { supplierId: a.supplierId, litres: 5_000 });
    expect(await notifyStockChange(db, b.shopId, entry.id, send)).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it("changing one shop's number leaves the other's alone", async () => {
    await setStockAlertPhone(db, a.owner, '+254744444444');
    const [shopB] = await db.select().from(shops).where(eq(shops.id, b.shopId));
    expect(shopB.stockAlertWhatsapp).toBe('+254722222222');
  });
});
