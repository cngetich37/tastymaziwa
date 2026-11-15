/**
 * Seed a shop (for local development, demos and e2e tests).
 *   npm run db:seed            → a shop + verified owner + default supplier
 *   npm run db:seed -- --demo  → instead, the "Try the demo" sample shop: six weeks of
 *                                trading, plus seller@example.com and supplier@example.com
 *                                (SEED_SELLER_EMAIL / SEED_SUPPLIER_EMAIL) logins
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
import { createSupplier, setSalePrice, type Actor } from '../src/server/ledger';
import { populateDemoShop } from '../src/server/demo/data';
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

  // --- demo trading (the same sample shop as 'Try the demo') --------------
  const hasEntries = (await db.$count(ledgerEntries, eq(ledgerEntries.shopId, shopId))) > 0;
  if (demo && hasEntries) console.log('Ledger already has entries — skipping demo data.');
  if (demo && !hasEntries) {
    const result = await db.transaction((tx) =>
      populateDemoShop(tx, {
        shopId,
        ownerId,
        emails: {
          seller: (process.env.SEED_SELLER_EMAIL ?? 'seller@example.com').toLowerCase(),
          supplier: (process.env.SEED_SUPPLIER_EMAIL ?? 'supplier@example.com').toLowerCase(),
        },
      }),
    );
    console.log(`Added six weeks of demo trading (${result.entries} ledger entries).`);
    console.log('Seller and supplier logins: seller@example.com, supplier@example.com (sign in with an email code).');
  } else {
    // --- default supplier ---------------------------------------------------
    const [supplier] = await db.select().from(suppliers).where(eq(suppliers.shopId, shopId)).limit(1);
    if (!supplier) {
      await createSupplier(db, actor, { name: 'Milkman', defaultPricePerLitre: 5000 });
      console.log('Added default supplier "Milkman" at KSh 50/L.');
    }

    // --- selling price (attendants cannot sell until the owner sets one) ----
    const [shopRow] = await db.select().from(shops).where(eq(shops.id, shopId));
    if (shopRow?.salePricePerLitreCents == null) {
      await setSalePrice(db, actor, 7000);
      console.log('Set the selling price to KSh 70/L.');
    }
  }
} finally {
  await close();
}
