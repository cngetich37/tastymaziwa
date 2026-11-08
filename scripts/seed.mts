/**
 * Seed a shop (for local development, demos and e2e tests).
 *   npm run db:seed            → a shop + verified owner + default supplier
 *   npm run db:seed -- --demo  → also two weeks of realistic demo trading
 *
 * Owner: SEED_OWNER_EMAIL (default owner@example.com) / SEED_OWNER_PASSWORD
 * (default: generated and printed once). Shop: SEED_SHOP_NAME (default
 * "Demo Dairy"). Re-running reuses the shop that owner belongs to.
 * Real shops are created through sign-up.
 * Demo data is generated relative to today at seed time, so it never needs
 * shifting on read.
 */
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createDb, migrateDb } from '../src/db/client';
import { ledgerEntries, shops, suppliers, users } from '../src/db/schema';
import { addDays, todayBusinessDate } from '../src/lib/dates';
import { lineTotalCents } from '../src/lib/money';
import { createCustomer, createSubscription, createSupplier, setSalePrice, type Actor } from '../src/server/ledger';
import { createShopWithOwner } from '../src/server/users';

const demo = process.argv.includes('--demo');
const { db, close } = await createDb();
await migrateDb(db);

try {
  // --- shop + owner ---------------------------------------------------------
  const email = (process.env.SEED_OWNER_EMAIL ?? 'owner@example.com').toLowerCase();
  const [existing] = await db.select().from(users).where(eq(users.email, email));
  let ownerId: string;
  let shopId: string;
  if (existing) {
    ownerId = existing.id;
    shopId = existing.shopId;
    console.log(`Owner ${email} already exists — reusing their shop.`);
  } else {
    const generated = !process.env.SEED_OWNER_PASSWORD;
    const password = process.env.SEED_OWNER_PASSWORD ?? randomBytes(9).toString('base64url');
    const { shop, owner } = await createShopWithOwner(db, {
      shopName: process.env.SEED_SHOP_NAME ?? 'Demo Dairy',
      name: 'Shop Owner',
      email,
      password,
    });
    ownerId = owner.id;
    shopId = shop.id;
    console.log(`Shop "${shop.name}" with owner: ${email}`);
    if (generated) console.log(`Password:      ${password}   (shown once — store it safely)`);
  }
  const actor: Actor = { id: ownerId, role: 'owner', shopId };

  // --- default supplier ----------------------------------------------------
  let [supplier] = await db.select().from(suppliers).where(eq(suppliers.shopId, shopId)).limit(1);
  if (!supplier) {
    supplier = await createSupplier(db, actor, { name: 'Milkman', defaultPricePerLitre: 5000 });
    console.log('Added default supplier "Milkman" at KSh 50/L.');
  }

  // --- selling price (attendants can't sell until the owner sets one) ------
  const [shopRow] = await db.select().from(shops).where(eq(shops.id, shopId));
  if (shopRow?.salePricePerLitreCents == null) {
    await setSalePrice(db, actor, 7000);
    console.log('Set the selling price to KSh 70/L.');
  }

  // --- demo trading --------------------------------------------------------
  if (demo) {
    const count = await db.$count(ledgerEntries, eq(ledgerEntries.shopId, shopId));
    if (count > 0) {
      console.log('Ledger already has entries — skipping demo data.');
    } else {
      const jane = await createCustomer(db, actor, { name: 'Jane Achieng', phone: '+254712345678', address: 'Block C' });
      const peter = await createCustomer(db, actor, { name: 'Peter Kamau', phone: '+254722000111' });
      const mama = await createCustomer(db, actor, { name: 'Mama Wanjiku', address: 'Gate 2' });
      const today = todayBusinessDate();
      const sub = await createSubscription(db, actor, {
        customerId: mama.id,
        dailyLitres: 2000,
        pricePerLitre: 6500,
        startDate: addDays(today, -13),
      });

      // Deterministic pseudo-random so demo data is the same on every run.
      let seed = 42;
      const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
      const rows: (typeof ledgerEntries.$inferInsert)[] = [];
      for (let d = 13; d >= 0; d--) {
        const date = addDays(today, -d);
        const at = (hour: number) => new Date(`${date}T${String(hour - 3).padStart(2, '0')}:00:00Z`);
        const deliveredMl = (45 + Math.floor(rand() * 15)) * 1000;
        rows.push({ shopId, kind: 'delivery', businessDate: date, occurredAt: at(6), volumeMl: deliveredMl, unitPriceCents: 5000, amountCents: lineTotalCents(deliveredMl, 5000), supplierId: supplier.id, createdBy: ownerId });
        const cashMl = (20 + Math.floor(rand() * 10)) * 1000;
        rows.push({ shopId, kind: 'sale', paymentMethod: 'cash', businessDate: date, occurredAt: at(9), volumeMl: cashMl, unitPriceCents: 7000, amountCents: lineTotalCents(cashMl, 7000), createdBy: ownerId });
        const mpesaMl = (10 + Math.floor(rand() * 10)) * 1000;
        rows.push({ shopId, kind: 'sale', paymentMethod: 'mpesa', businessDate: date, occurredAt: at(17), volumeMl: mpesaMl, unitPriceCents: 7000, amountCents: lineTotalCents(mpesaMl, 7000), createdBy: ownerId });
        if (d % 3 === 0) {
          const who = d % 2 ? jane : peter;
          rows.push({ shopId, kind: 'sale', paymentMethod: 'credit', customerId: who.id, businessDate: date, occurredAt: at(12), volumeMl: 5000, unitPriceCents: 7000, amountCents: 35000, dueDate: addDays(date, 7), createdBy: ownerId });
        }
        if (d % 4 === 1) rows.push({ shopId, kind: 'spoilage', businessDate: date, occurredAt: at(20), volumeMl: 1500, expenseCategory: 'sour', createdBy: ownerId });
        if (d % 2 === 0) rows.push({ shopId, kind: 'expense', businessDate: date, occurredAt: at(8), amountCents: 20000, expenseCategory: 'transport', createdBy: ownerId });
        if (d % 7 === 0) rows.push({ shopId, kind: 'supplier_payment', paymentMethod: 'mpesa', businessDate: date, occurredAt: at(18), amountCents: 1_000_000, supplierId: supplier.id, createdBy: ownerId });
        if (d === 5) rows.push({ shopId, kind: 'customer_payment', paymentMethod: 'mpesa', customerId: jane.id, businessDate: date, occurredAt: at(19), amountCents: 20000, createdBy: ownerId });
        if (d > 0) {
          rows.push({ shopId, kind: 'sale', paymentMethod: 'credit', customerId: mama.id, businessDate: date, occurredAt: at(7), volumeMl: 2000, unitPriceCents: 6500, amountCents: 13000, dueDate: addDays(date, 7), subscriptionId: sub.id, note: 'Subscription delivery', idempotencyKey: `sub:${sub.id}:${date}`, createdBy: ownerId });
        }
      }
      await db.insert(ledgerEntries).values(rows);
      console.log(`Added 3 customers, 1 subscription and ${rows.length} demo ledger entries.`);
    }
  }
} finally {
  await close();
}
