/**
 * Supplier-recorded deliveries: the supplier records, the seller approves.
 * Only an approved delivery reaches the ledger (and so stock and payables).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createDb, migrateDb, type DB } from '@/db/client';
import { auditLog, deliverySubmissions, ledgerEntries, shops, users } from '@/db/schema';
import { todayBusinessDate } from '@/lib/dates';
import {
  createSupplier,
  recordDelivery,
  recordSale,
  reviewDelivery,
  submitDelivery,
  type Actor,
} from './ledger';
import { getStockOnHandMl, getSupplierPortal, listDeliverySubmissions, listSuppliers } from './queries';
import { setUserRole } from './auth/accounts';

let db: DB;
let close: () => Promise<void>;

interface ShopActors {
  shopId: string;
  supplierId: string;
  owner: Actor;
  seller: Actor;
  milkman: Actor;
}

async function makeShop(name: string): Promise<ShopActors> {
  const [shop] = await db.insert(shops).values({ name }).returning();
  const insertUser = async (role: 'owner' | 'attendant' | 'supplier', supplierId: string | null = null) => {
    const [u] = await db
      .insert(users)
      .values({ shopId: shop.id, name: role, email: `${role}@${shop.id}.test`, passwordHash: 'x', role, supplierId })
      .returning();
    return { id: u.id, role, shopId: shop.id } satisfies Actor;
  };
  const owner = await insertUser('owner');
  const seller = await insertUser('attendant');
  const supplier = await createSupplier(db, owner, { name: `${name} Milkman`, defaultPricePerLitre: 5000 });
  const milkman = await insertUser('supplier', supplier.id);
  return { shopId: shop.id, supplierId: supplier.id, owner, seller, milkman };
}

let a: ShopActors;
let b: ShopActors;

beforeAll(async () => {
  ({ db, close } = await createDb({ pgliteDir: 'memory://' }));
  await migrateDb(db);
  a = await makeShop('Shop A');
  b = await makeShop('Shop B');
});

afterAll(() => close());

const deliveriesFor = (shopId: string) =>
  db.select().from(ledgerEntries).where(and(eq(ledgerEntries.shopId, shopId), eq(ledgerEntries.kind, 'delivery')));

describe('supplier records, seller approves', () => {
  it('keeps a recorded delivery out of the ledger until it is approved', async () => {
    const sub = await submitDelivery(db, a.milkman, { litres: 40_000, note: 'Morning run' });
    expect(sub.status).toBe('pending');
    expect(sub.supplierId).toBe(a.supplierId);
    expect(sub.businessDate).toBe(todayBusinessDate());
    expect(await deliveriesFor(a.shopId)).toHaveLength(0);
    expect(await getStockOnHandMl(db, a.shopId)).toBe(0);

    const pending = await listDeliverySubmissions(db, a.shopId, { status: 'pending' });
    expect(pending.map((p) => p.id)).toEqual([sub.id]);
    expect(pending[0].supplierName).toBe('Shop A Milkman');
  });

  it('posts the delivery at the agreed price when the seller approves', async () => {
    const [sub] = await listDeliverySubmissions(db, a.shopId, { status: 'pending' });
    const reviewed = await reviewDelivery(db, a.seller, { submissionId: sub.id, decision: 'approve' });
    expect(reviewed.status).toBe('approved');
    expect(reviewed.reviewedBy).toBe(a.seller.id);

    const [entry] = await deliveriesFor(a.shopId);
    expect(entry.id).toBe(reviewed.ledgerEntryId);
    expect(entry.volumeMl).toBe(40_000);
    expect(entry.unitPriceCents).toBe(5000);
    expect(entry.amountCents).toBe(200_000);
    expect(entry.supplierId).toBe(a.supplierId);
    expect(entry.businessDate).toBe(sub.businessDate);
    expect(entry.createdBy).toBe(a.seller.id);
    expect(await getStockOnHandMl(db, a.shopId)).toBe(40_000);
    const [supplier] = await listSuppliers(db, a.shopId);
    expect(supplier.payableCents).toBe(200_000);

    const audits = await db.select().from(auditLog).where(eq(auditLog.entityId, sub.id));
    expect(audits.map((r) => r.action).sort()).toEqual(['delivery.approve', 'delivery.submit']);
  });

  it('decides each delivery once', async () => {
    const [sub] = await listDeliverySubmissions(db, a.shopId, { status: 'approved' });
    await expect(reviewDelivery(db, a.owner, { submissionId: sub.id, decision: 'approve' })).rejects.toThrow(
      'This delivery was already approved',
    );
    await expect(
      reviewDelivery(db, a.owner, { submissionId: sub.id, decision: 'reject', reason: 'late' }),
    ).rejects.toThrow('already approved');
    expect(await deliveriesFor(a.shopId)).toHaveLength(1);
  });

  it('sends a rejected delivery back with the reason and posts nothing', async () => {
    const sub = await submitDelivery(db, a.milkman, { litres: 50_000 });
    const reviewed = await reviewDelivery(db, a.seller, {
      submissionId: sub.id,
      decision: 'reject',
      reason: 'Only 45 L arrived',
    });
    expect(reviewed.status).toBe('rejected');
    expect(reviewed.ledgerEntryId).toBeNull();
    expect(await deliveriesFor(a.shopId)).toHaveLength(1);

    const portal = await getSupplierPortal(db, a.shopId, a.milkman.id!);
    expect(portal?.submissions[0]).toMatchObject({ status: 'rejected', reviewNote: 'Only 45 L arrived', reviewedByName: 'attendant' });
    expect(portal?.supplier.payableCents).toBe(200_000);
  });

  it('needs the owner to have agreed a price before approval', async () => {
    const noPrice = await createSupplier(db, a.owner, { name: 'New Milkman' });
    const [u] = await db
      .insert(users)
      .values({ shopId: a.shopId, name: 'New', email: 'new@milk.test', role: 'supplier', supplierId: noPrice.id })
      .returning();
    const newMilkman: Actor = { id: u.id, role: 'supplier', shopId: a.shopId };
    const sub = await submitDelivery(db, newMilkman, { litres: 10_000 });
    await expect(reviewDelivery(db, a.seller, { submissionId: sub.id, decision: 'approve' })).rejects.toThrow(
      "The owner has not set New Milkman's price per litre yet",
    );
    const [still] = await db.select().from(deliverySubmissions).where(eq(deliverySubmissions.id, sub.id));
    expect(still.status).toBe('pending');
  });
});

describe('separation of duties', () => {
  it('lets a supplier record deliveries only, never ledger entries or approvals', async () => {
    await expect(recordSale(db, a.milkman, { litres: 1000, paymentMethod: 'cash' })).rejects.toThrow(
      'You do not have permission',
    );
    await expect(recordDelivery(db, a.milkman, { supplierId: a.supplierId, litres: 1000 })).rejects.toThrow();
    const sub = await submitDelivery(db, a.milkman, { litres: 1000 });
    await expect(reviewDelivery(db, a.milkman, { submissionId: sub.id, decision: 'approve' })).rejects.toThrow(
      'Only the shop can approve deliveries',
    );
  });

  it('only lets suppliers submit, and only for their own supplier', async () => {
    await expect(submitDelivery(db, a.seller, { litres: 1000 })).rejects.toThrow('Only suppliers');
    await expect(submitDelivery(db, a.owner, { litres: 1000 })).rejects.toThrow('Only suppliers');
  });

  it("stops the seller typing in a delivery for a supplier who records their own", async () => {
    await expect(recordDelivery(db, a.seller, { supplierId: a.supplierId, litres: 1000 })).rejects.toThrow(
      'records their own deliveries',
    );
    // The owner keeps an override (audited), e.g. when the milkman's phone is broken.
    const entry = await recordDelivery(db, a.owner, { supplierId: a.supplierId, litres: 1000 });
    expect(entry.kind).toBe('delivery');
    // Suppliers without a login are still recorded by the seller.
    const walkIn = await createSupplier(db, a.owner, { name: 'Walk-in farmer', defaultPricePerLitre: 4500 });
    await expect(recordDelivery(db, a.seller, { supplierId: walkIn.id, litres: 2000 })).resolves.toBeTruthy();
  });

  it("won't switch a supplier login to a shop role", async () => {
    await expect(setUserRole(db, a.owner, a.milkman.id!, 'owner')).rejects.toThrow("can't be switched");
  });

  it('enforces the supplier link in the database', async () => {
    await expect(
      db.insert(users).values({ shopId: a.shopId, name: 'X', email: 'x@milk.test', role: 'supplier' }),
    ).rejects.toThrow();
    await expect(
      db
        .insert(users)
        .values({ shopId: a.shopId, name: 'Y', email: 'y@milk.test', role: 'attendant', supplierId: a.supplierId }),
    ).rejects.toThrow();
  });
});

describe('tenant isolation', () => {
  it("never shows or decides another shop's deliveries", async () => {
    const subB = await submitDelivery(db, b.milkman, { litres: 7000 });
    expect((await listDeliverySubmissions(db, a.shopId)).some((s) => s.id === subB.id)).toBe(false);
    await expect(reviewDelivery(db, a.seller, { submissionId: subB.id, decision: 'approve' })).rejects.toThrow(
      'Delivery not found',
    );
    await expect(
      reviewDelivery(db, a.owner, { submissionId: subB.id, decision: 'reject', reason: 'x' }),
    ).rejects.toThrow('Delivery not found');
    expect(await deliveriesFor(b.shopId)).toHaveLength(0);
  });

  it("gives a supplier login only its own shop's portal", async () => {
    expect(await getSupplierPortal(db, a.shopId, b.milkman.id!)).toBeNull();
    const portal = await getSupplierPortal(db, b.shopId, b.milkman.id!);
    expect(portal?.submissions.every((s) => s.supplierId === b.supplierId)).toBe(true);
  });

  it("can't link a login to another shop's supplier", async () => {
    await expect(
      db
        .insert(users)
        .values({ shopId: a.shopId, name: 'Z', email: 'z@milk.test', role: 'supplier', supplierId: b.supplierId }),
    ).rejects.toThrow();
  });
});
