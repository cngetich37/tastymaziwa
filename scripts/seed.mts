/**
 * Seed the database.
 *   npm run db:seed            → owner account + default supplier (safe on an empty DB)
 *   npm run db:seed -- --demo  → also two weeks of realistic demo trading
 *
 * Owner credentials come from SEED_OWNER_USERNAME / SEED_OWNER_PASSWORD, or
 * default to "owner" with a generated password printed once.
 * Demo data is generated relative to today at seed time, so it never needs
 * shifting on read.
 */
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createDb, migrateDb } from '../src/db/client';
import { ledgerEntries, suppliers, users } from '../src/db/schema';
import { addDays, todayBusinessDate } from '../src/lib/dates';
import { lineTotalCents } from '../src/lib/money';
import { createCustomer, createSubscription, createSupplier, SYSTEM_ACTOR } from '../src/server/ledger';
import { createUser } from '../src/server/users';

const demo = process.argv.includes('--demo');
const { db, close } = await createDb();
await migrateDb(db);

try {
  // --- owner ---------------------------------------------------------------
  const username = (process.env.SEED_OWNER_USERNAME ?? 'owner').toLowerCase();
  const [existing] = await db.select().from(users).where(eq(users.username, username));
  let ownerId = existing?.id;
  if (!existing) {
    const generated = !process.env.SEED_OWNER_PASSWORD;
    const password = process.env.SEED_OWNER_PASSWORD ?? randomBytes(9).toString('base64url');
    const owner = await createUser(db, SYSTEM_ACTOR, { username, password, name: 'Shop Owner', role: 'owner' });
    ownerId = owner.id;
    console.log(`Owner account: ${username}`);
    if (generated) console.log(`Password:      ${password}   (shown once — store it safely)`);
  } else {
    console.log(`Owner "${username}" already exists — skipping.`);
  }

  // --- default supplier ----------------------------------------------------
  let [supplier] = await db.select().from(suppliers).limit(1);
  if (!supplier) {
    supplier = await createSupplier(db, SYSTEM_ACTOR, { name: 'Milkman', defaultPricePerLitre: 5000 });
    console.log('Added default supplier "Milkman" at KSh 50/L.');
  }

  // --- demo trading --------------------------------------------------------
  if (demo) {
    const count = await db.$count(ledgerEntries);
    if (count > 0) {
      console.log('Ledger already has entries — skipping demo data.');
    } else {
      const actor = { id: ownerId!, role: 'owner' as const };
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
        rows.push({ kind: 'delivery', businessDate: date, occurredAt: at(6), volumeMl: deliveredMl, unitPriceCents: 5000, amountCents: lineTotalCents(deliveredMl, 5000), supplierId: supplier.id, createdBy: ownerId });
        const cashMl = (20 + Math.floor(rand() * 10)) * 1000;
        rows.push({ kind: 'sale', paymentMethod: 'cash', businessDate: date, occurredAt: at(9), volumeMl: cashMl, unitPriceCents: 7000, amountCents: lineTotalCents(cashMl, 7000), createdBy: ownerId });
        const mpesaMl = (10 + Math.floor(rand() * 10)) * 1000;
        rows.push({ kind: 'sale', paymentMethod: 'mpesa', businessDate: date, occurredAt: at(17), volumeMl: mpesaMl, unitPriceCents: 7000, amountCents: lineTotalCents(mpesaMl, 7000), createdBy: ownerId });
        if (d % 3 === 0) {
          const who = d % 2 ? jane : peter;
          rows.push({ kind: 'sale', paymentMethod: 'credit', customerId: who.id, businessDate: date, occurredAt: at(12), volumeMl: 5000, unitPriceCents: 7000, amountCents: 35000, dueDate: addDays(date, 7), createdBy: ownerId });
        }
        if (d % 4 === 1) rows.push({ kind: 'spoilage', businessDate: date, occurredAt: at(20), volumeMl: 1500, expenseCategory: 'sour', createdBy: ownerId });
        if (d % 2 === 0) rows.push({ kind: 'expense', businessDate: date, occurredAt: at(8), amountCents: 20000, expenseCategory: 'transport', createdBy: ownerId });
        if (d % 7 === 0) rows.push({ kind: 'supplier_payment', paymentMethod: 'mpesa', businessDate: date, occurredAt: at(18), amountCents: 1_000_000, supplierId: supplier.id, createdBy: ownerId });
        if (d === 5) rows.push({ kind: 'customer_payment', paymentMethod: 'mpesa', customerId: jane.id, businessDate: date, occurredAt: at(19), amountCents: 20000, createdBy: ownerId });
        if (d > 0) {
          rows.push({ kind: 'sale', paymentMethod: 'credit', customerId: mama.id, businessDate: date, occurredAt: at(7), volumeMl: 2000, unitPriceCents: 6500, amountCents: 13000, dueDate: addDays(date, 7), subscriptionId: sub.id, note: 'Subscription delivery', idempotencyKey: `sub:${sub.id}:${date}`, createdBy: ownerId });
        }
      }
      await db.insert(ledgerEntries).values(rows);
      console.log(`Added 3 customers, 1 subscription and ${rows.length} demo ledger entries.`);
    }
  }
} finally {
  await close();
}
