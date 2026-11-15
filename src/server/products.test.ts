/** Products other than milk: priced by the owner, stocked from the ledger. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, migrateDb, type DB } from '@/db/client';
import { shops, users } from '@/db/schema';
import {
  createProduct,
  createSupplier,
  recordDelivery,
  recordSale,
  recordSpoilage,
  reverseEntry,
  setProductArchived,
  setSalePrice,
  updateProduct,
  type Actor,
} from './ledger';
import { getDashboard, getStockLevels, listEntries } from './queries';

let db: DB;
let close: () => Promise<void>;

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
  const supplier = await createSupplier(db, owner, { name: 'Wholesaler', defaultPricePerLitre: 5000 });
  await setSalePrice(db, owner, 7000);
  return { shopId: shop.id, owner, seller, supplierId: supplier.id };
}

const malaOf = async (shopId: string) => (await getStockLevels(db, shopId)).find((l) => l.name === 'Mala 500ml')!;

let a: Awaited<ReturnType<typeof makeShop>>;
let b: Awaited<ReturnType<typeof makeShop>>;

beforeAll(async () => {
  ({ db, close } = await createDb({ pgliteDir: 'memory://' }));
  await migrateDb(db);
  a = await makeShop('A');
  b = await makeShop('B');
});

afterAll(() => close());

describe('products', () => {
  it('sells a product at its price and tracks its stock apart from milk', async () => {
    const mala = await createProduct(db, a.owner, {
      name: 'Mala 500ml',
      unit: 'piece',
      salePrice: 6000,
      costPrice: 4500,
      reorderLevel: 5000,
    });
    // The owner buys 12 packets from the wholesaler at the usual cost.
    const bought = await recordDelivery(db, a.owner, { supplierId: a.supplierId, productId: mala.id, litres: 12_000 });
    expect(bought.amountCents).toBe(54_000);
    // The seller sells 3 at the owner's price, and 10 L of milk arrives.
    const sold = await recordSale(db, a.seller, { productId: mala.id, litres: 3000, paymentMethod: 'cash' });
    expect(sold.unitPriceCents).toBe(6000);
    expect(sold.amountCents).toBe(18_000);
    await recordDelivery(db, a.owner, { supplierId: a.supplierId, litres: 10_000 });
    await recordSpoilage(db, a.owner, { productId: mala.id, litres: 1000, reason: 'returned' });

    const levels = await getStockLevels(db, a.shopId);
    expect(levels.find((l) => l.productId === null)?.onHand).toBe(10_000);
    expect(levels.find((l) => l.productId === mala.id)).toMatchObject({ onHand: 8000, sold7d: 3000, low: false });

    const dash = await getDashboard(db, a.shopId);
    expect(dash.todaySummary.salesCents).toBe(18_000);
    expect(dash.todaySummary.salesMl).toBe(0); // no milk sold
    expect(dash.stockOnHandMl).toBe(10_000);

    const [entry] = await listEntries(db, a.shopId, { kinds: ['sale'] });
    expect(entry).toMatchObject({ productName: 'Mala 500ml', productUnit: 'piece' });
  });

  it('flags low stock at the reorder level, and reversals restore stock', async () => {
    const mala = await malaOf(a.shopId);
    const sale = await recordSale(db, a.owner, { productId: mala.productId!, litres: 3000, paymentMethod: 'mpesa' });
    expect((await getStockLevels(db, a.shopId)).find((l) => l.productId === mala.productId)).toMatchObject({
      onHand: 5000,
      low: true,
    });
    await reverseEntry(db, a.owner, sale.id, 'wrong product');
    expect((await getStockLevels(db, a.shopId)).find((l) => l.productId === mala.productId)?.onHand).toBe(8000);
  });

  it("keeps prices the owner's: sellers can't override or buy stock", async () => {
    const mala = await malaOf(a.shopId);
    await expect(
      recordSale(db, a.seller, { productId: mala.productId!, litres: 1000, pricePerLitre: 1, paymentMethod: 'cash' }),
    ).rejects.toThrow('Only the owner can change prices');
    await expect(
      recordDelivery(db, a.seller, { supplierId: a.supplierId, productId: mala.productId!, litres: 1000 }),
    ).rejects.toThrow('Only the owner can record stock purchases');
    const unpriced = await createProduct(db, a.owner, { name: 'Ghee', unit: 'kg' });
    await expect(recordSale(db, a.seller, { productId: unpriced.id, litres: 500, paymentMethod: 'cash' })).rejects.toThrow(
      "The owner has not set Ghee's price yet",
    );
  });

  it("won't change a used product's unit, and stops selling archived products", async () => {
    const mala = await malaOf(a.shopId);
    await expect(
      updateProduct(db, a.owner, { productId: mala.productId!, name: 'Mala', unit: 'litre', salePrice: 6000 }),
    ).rejects.toThrow("unit can't change");
    await setProductArchived(db, a.owner, mala.productId!, true);
    await expect(recordSale(db, a.owner, { productId: mala.productId!, litres: 1000, paymentMethod: 'cash' })).rejects.toThrow(
      'no longer sold',
    );
    expect((await getStockLevels(db, a.shopId)).some((l) => l.productId === mala.productId)).toBe(false);
    await setProductArchived(db, a.owner, mala.productId!, false);
  });
});

describe('tenant isolation', () => {
  it("never sells, edits or lists another shop's products", async () => {
    const mala = await malaOf(a.shopId);
    await expect(recordSale(db, b.owner, { productId: mala.productId!, litres: 1000, paymentMethod: 'cash' })).rejects.toThrow(
      'Product not found',
    );
    await expect(
      updateProduct(db, b.owner, { productId: mala.productId!, name: 'Hijacked', unit: 'piece' }),
    ).rejects.toThrow('Product not found');
    await expect(setProductArchived(db, b.owner, mala.productId!, true)).rejects.toThrow('Product not found');
    expect((await getStockLevels(db, b.shopId)).map((l) => l.name)).toEqual(['Fresh milk']);
  });
});
