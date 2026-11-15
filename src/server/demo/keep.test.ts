/**
 * "Keep what I added": signing up from a demo shop copies only the
 * visitor's own setup into the new real shop, never sample data or trading.
 */
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb, migrateDb, type DB } from '@/db/client';
import { customers, employees, expenseBudgets, ledgerEntries, products, shops, subscriptions, suppliers, users } from '@/db/schema';
import { todayBusinessDate } from '@/lib/dates';
import { completeSignup, requestSignup, type AuthUser } from '../auth/accounts';
import {
  createCustomer,
  createEmployee,
  createProduct,
  createSubscription,
  recordSale,
  setBudgets,
  setProductArchived,
  setSalePrice,
  updateSupplier,
  type Actor,
} from '../ledger';
import { createDemoShop } from './demo';
import { summarizeDemoKeep } from './keep';

const outbox = mkdtempSync(path.join(tmpdir(), 'tm-keep-outbox-'));
process.env.EMAIL_OUTBOX_DIR = outbox;
process.env.EMAIL_TRANSPORT = 'file';

let db: DB;
let close: () => Promise<void>;
let demoShopId: string;
let owner: Actor;

const codeFor = (to: string) => {
  const mail = readdirSync(outbox)
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(outbox, f), 'utf8')) as { to: string; text: string })
    .filter((m) => m.to === to)
    .at(-1);
  return /\b(\d{6})\b/.exec(mail?.text ?? '')?.[1] ?? '';
};

async function signUp(email: string, fromDemoShopId?: string): Promise<AuthUser> {
  const input = { shopName: 'Njeri Dairy', name: 'Njeri', email, password: 'correct horse battery' };
  await requestSignup(db, input, `ip-${email}`, { fromDemoShopId });
  const user = await completeSignup(db, email, codeFor(email));
  if (typeof user === 'string') throw new Error(`sign-up failed: ${user}`);
  return user;
}

beforeAll(async () => {
  process.env.AUTH_SECRET ??= 'test-secret-for-keep';
  ({ db, close } = await createDb({ pgliteDir: 'memory://' }));
  await migrateDb(db);
  const demo = await createDemoShop(db, { expiresAt: new Date(Date.now() + 86_400_000) });
  demoShopId = demo.shopId;
  owner = { id: demo.ownerId, role: 'owner', shopId: demo.shopId };
});

afterAll(() => close());

describe('keeping a demo shop at sign-up', () => {
  it('keeps nothing when the visitor added nothing', async () => {
    expect(await summarizeDemoKeep(db, demoShopId)).toEqual({
      customers: 0,
      suppliers: 0,
      products: 0,
      staff: 0,
      subscriptions: 0,
      budgets: 0,
      salePrice: false,
    });
  });

  it('copies only what the visitor added or changed, with empty books', async () => {
    // What the visitor does while trying the demo.
    const mine = await createCustomer(db, owner, { name: 'Wambui (my customer)', phone: '+254711222333', creditLimit: 300_000 });
    const [kiprono] = await db.select().from(suppliers).where(eq(suppliers.name, 'Kiprono Dairy Farm'));
    await updateSupplier(db, owner, { supplierId: kiprono.id, name: 'Kiprono Dairy Farm', defaultPricePerLitre: 5500 });
    await createProduct(db, owner, { name: 'Lala 1 L', unit: 'piece', salePrice: 9000, costPrice: 7000 });
    const dropped = await createProduct(db, owner, { name: 'Tried and archived', unit: 'piece' });
    await setProductArchived(db, owner, dropped.id, true);
    await createEmployee(db, owner, { name: 'Akinyi', payType: 'daily', rate: 60_000, statutory: false });
    const [jane] = await db.select().from(customers).where(eq(customers.name, 'Jane Achieng'));
    await createSubscription(db, owner, { customerId: jane.id, dailyLitres: 1000, pricePerLitre: 7500, startDate: '2020-01-01' });
    await setBudgets(db, owner, { budgets: [{ category: 'transport', monthly: 500_000 }] });
    await setSalePrice(db, owner, 7500);
    await recordSale(db, owner, { litres: 2000, paymentMethod: 'cash', customerId: mine.id });

    expect(await summarizeDemoKeep(db, demoShopId)).toEqual({
      customers: 2, // their own + Jane, whose subscription they set up
      suppliers: 1,
      products: 1,
      staff: 1,
      subscriptions: 1,
      budgets: 6,
      salePrice: true,
    });

    const user = await signUp('njeri@example.com', demoShopId);
    const shopId = user.shopId;
    const [shop] = await db.select().from(shops).where(eq(shops.id, shopId));
    expect(shop).toMatchObject({ name: 'Njeri Dairy', demoExpiresAt: null, salePricePerLitreCents: 7500 });

    const names = async <T extends { name: string }>(rows: Promise<T[]>) => (await rows).map((r) => r.name).sort();
    expect(await names(db.select().from(customers).where(eq(customers.shopId, shopId)))).toEqual(['Jane Achieng', 'Wambui (my customer)']);
    expect(await names(db.select().from(suppliers).where(eq(suppliers.shopId, shopId)))).toEqual(['Kiprono Dairy Farm']);
    expect(await names(db.select().from(products).where(eq(products.shopId, shopId)))).toEqual(['Lala 1 L']);
    expect(await names(db.select().from(employees).where(eq(employees.shopId, shopId)))).toEqual(['Akinyi']);

    const [kept] = await db.select().from(customers).where(eq(customers.name, 'Wambui (my customer)')).then((r) => r.filter((c) => c.shopId === shopId));
    expect(kept).toMatchObject({ phone: '+254711222333', creditLimitCents: 300_000 });
    const [supplier] = await db.select().from(suppliers).where(eq(suppliers.shopId, shopId));
    expect(supplier.defaultPricePerLitreCents).toBe(5500);
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.shopId, shopId));
    const [keptJane] = await db.select().from(customers).where(eq(customers.shopId, shopId)).then((r) => r.filter((c) => c.name === 'Jane Achieng'));
    expect(sub).toMatchObject({ customerId: keptJane.id, dailyMl: 1000, startDate: todayBusinessDate() });
    expect(await db.select().from(expenseBudgets).where(eq(expenseBudgets.shopId, shopId))).toHaveLength(6);

    // Books start empty; the demo itself is untouched and still a demo.
    expect(await db.$count(ledgerEntries, eq(ledgerEntries.shopId, shopId))).toBe(0);
    expect(await db.$count(users, eq(users.shopId, shopId))).toBe(1);
    const [demo] = await db.select().from(shops).where(eq(shops.id, demoShopId));
    expect(demo.demoExpiresAt).not.toBeNull();
  });

  it('a plain sign-up keeps nothing, and a real shop is never copied from', async () => {
    const plain = await signUp('plain@example.com');
    expect(await db.$count(customers, eq(customers.shopId, plain.shopId))).toBe(0);

    // Even if a real shop's id reached the pending sign-up, nothing is copied.
    const real = await signUp('again@example.com', plain.shopId);
    expect(await db.$count(customers, eq(customers.shopId, real.shopId))).toBe(0);
  });
});
