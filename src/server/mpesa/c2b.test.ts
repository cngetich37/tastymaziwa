/** Till/paybill reconciliation (Daraja C2B) against a fake Daraja and real Postgres. */
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb, migrateDb, type DB } from '@/db/client';
import { ledgerEntries, mpesaC2bTransactions, mpesaRequests, shops, users } from '@/db/schema';
import { createCustomer, recordSale, reverseEntry, setSalePrice, type Actor } from '../ledger';
import { listCustomers } from '../queries';
import { connectTill, getTillReconciliation, handleC2bConfirmation, ignoreC2b, matchToCustomer, matchToSale, salesForAmount } from './c2b';
import { darajaTimestamp } from './daraja';
import { saveMpesaSettings } from './payments';

let db: DB;
let close: () => Promise<void>;

function fakeDaraja() {
  const calls: { url: string; body: Record<string, unknown> | null }[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    const json = (d: object) => new Response(JSON.stringify(d), { status: 200 });
    if (url.includes('oauth')) return json({ access_token: 't', expires_in: '3599' });
    if (url.includes('c2b/v2/registerurl')) return json({ OriginatorCoversationID: 'x', ResponseCode: '0', ResponseDescription: 'Success' });
    return json({});
  }) as typeof fetch;
  return { impl, calls };
}

async function makeShop(name: string, shortcode: string) {
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
  await saveMpesaSettings(db, owner, {
    enabled: true,
    environment: 'sandbox',
    shortcodeType: 'paybill',
    businessShortcode: shortcode,
    accountReference: 'Duka',
    consumerKey: 'ck',
    consumerSecret: 'cs',
    passkey: 'pk',
  });
  const d = fakeDaraja();
  await connectTill(db, owner, d.impl);
  const register = d.calls.find((c) => c.url.includes('registerurl'))!.body!;
  const token = String(register.ConfirmationURL).split('/').at(-2)!;
  return { shopId: shop.id, owner, seller, token, register, shortcode };
}

let a: Awaited<ReturnType<typeof makeShop>>;
let b: Awaited<ReturnType<typeof makeShop>>;
let jane: { id: string };

const confirmation = (over: Record<string, unknown>) => ({
  TransactionType: 'Pay Bill',
  TransID: `T${Math.random().toString(36).slice(2, 11).toUpperCase()}`,
  TransTime: darajaTimestamp(new Date()),
  TransAmount: '140.00',
  BusinessShortCode: a.shortcode,
  BillRefNumber: '',
  MSISDN: '254700000001',
  FirstName: 'John',
  OrgAccountBalance: '1000.00',
  ...over,
});

const rowFor = async (transId: string) =>
  (await db.select().from(mpesaC2bTransactions).where(eq(mpesaC2bTransactions.transId, transId)))[0];
const entryCount = async (shopId: string) => (await db.select().from(ledgerEntries).where(eq(ledgerEntries.shopId, shopId))).length;

beforeAll(async () => {
  process.env.AUTH_SECRET ??= 'test-secret-for-c2b';
  process.env.APP_URL = 'https://duka.example';
  ({ db, close } = await createDb({ pgliteDir: 'memory://' }));
  await migrateDb(db);
  a = await makeShop('A', '600100');
  b = await makeShop('B', '600200');
  jane = await createCustomer(db, a.owner, { name: 'Jane', phone: '+254712345678' });
  await recordSale(db, a.owner, { litres: 10_000, paymentMethod: 'credit', customerId: jane.id }); // owes 700
});

afterAll(() => close());

describe('connecting the till', () => {
  it('registers v2 URLs with a secret, and no "mpesa" in them', () => {
    expect(a.register).toMatchObject({ ShortCode: '600100', ResponseType: 'Completed' });
    expect(String(a.register.ConfirmationURL)).toMatch(new RegExp(`^https://duka\\.example/api/payments/c2b/${a.shopId}/[\\w-]{20,}/confirm$`));
    expect(String(a.register.ValidationURL)).toMatch(/\/validate$/);
    expect(String(a.register.ConfirmationURL)).not.toMatch(/mpesa|safaricom/i);
  });

  it("is the owner's job", async () => {
    await expect(connectTill(db, a.seller, fakeDaraja().impl)).rejects.toThrow('Only the owner');
  });
});

describe('confirmations', () => {
  it('ignores forged secrets, other shortcodes and junk', async () => {
    const c = confirmation({});
    expect(await handleC2bConfirmation(db, a.shopId, 'wrong-secret', c)).toBe('ignored');
    expect(await handleC2bConfirmation(db, a.shopId, a.token, { ...c, BusinessShortCode: '999999' })).toBe('ignored');
    expect(await handleC2bConfirmation(db, a.shopId, a.token, { hello: 'world' })).toBe('ignored');
    // B's secret doesn't open A's door.
    expect(await handleC2bConfirmation(db, a.shopId, b.token, c)).toBe('ignored');
    expect(await rowFor(String(c.TransID))).toBeUndefined();
  });

  it('confirms a sale a seller recorded as M-Pesa, posting nothing new', async () => {
    await recordSale(db, a.seller, { litres: 2000, paymentMethod: 'mpesa' }); // 140
    const before = await entryCount(a.shopId);
    const c = confirmation({});
    expect(await handleC2bConfirmation(db, a.shopId, a.token, c)).toBe('matched_sale');
    expect(await handleC2bConfirmation(db, a.shopId, a.token, c)).toBe('duplicate');
    expect(await entryCount(a.shopId)).toBe(before);
    expect((await rowFor(String(c.TransID))).ledgerEntryId).not.toBeNull();
  });

  it('links a sale recorded after the customer already paid', async () => {
    const c = confirmation({ TransAmount: '210.00' });
    expect(await handleC2bConfirmation(db, a.shopId, a.token, c)).toBe('unmatched');
    const sale = await recordSale(db, a.seller, { litres: 3000, paymentMethod: 'mpesa' }); // 210
    expect(await rowFor(String(c.TransID))).toMatchObject({ status: 'matched_sale', ledgerEntryId: sale.id, matchedBy: a.seller.id });
  });

  it("posts a paybill payment to the customer whose phone is the account number", async () => {
    const c = confirmation({ TransAmount: '300', BillRefNumber: '0712345678' });
    expect(await handleC2bConfirmation(db, a.shopId, a.token, c)).toBe('posted_payment');
    const [entry] = await db.select().from(ledgerEntries).where(eq(ledgerEntries.idempotencyKey, `c2b:${c.TransID}`));
    expect(entry).toMatchObject({ kind: 'customer_payment', paymentMethod: 'mpesa', customerId: jane.id, amountCents: 30_000 });
    const balance = (await listCustomers(db, a.shopId)).find((x) => x.id === jane.id)!.balanceCents;
    expect(balance).toBe(70_000 - 30_000);
  });

  it('suggests the payer from a hashed number, but leaves the decision to the owner', async () => {
    const hash = createHash('sha256').update('254712345678').digest('hex');
    const c = confirmation({ TransAmount: '100', MSISDN: hash });
    expect(await handleC2bConfirmation(db, a.shopId, a.token, c)).toBe('unmatched');
    const row = await rowFor(String(c.TransID));
    expect(row).toMatchObject({ status: 'unmatched', customerId: jane.id, ledgerEntryId: null });

    await expect(matchToCustomer(db, a.seller, { c2bId: row.id, customerId: jane.id })).rejects.toThrow('Only the owner');
    await matchToCustomer(db, a.owner, { c2bId: row.id, customerId: jane.id });
    expect(await rowFor(String(c.TransID))).toMatchObject({ status: 'posted_payment', matchedBy: a.owner.id });
    await expect(matchToCustomer(db, a.owner, { c2bId: row.id, customerId: jane.id })).rejects.toThrow('already been matched');
  });

  it("recognises the shop's own STK prompt by its receipt", async () => {
    const sale = await recordSale(db, a.owner, { litres: 1000, paymentMethod: 'mpesa', note: 'stand-in' });
    await db.insert(mpesaRequests).values({
      shopId: a.shopId,
      purpose: 'sale',
      status: 'succeeded',
      amountCents: 7000,
      phone: '+254700000002',
      businessDate: sale.businessDate,
      callbackTokenHash: 'x',
      receiptNumber: 'STKRECEIPT1',
      ledgerEntryId: sale.id,
    });
    expect(await handleC2bConfirmation(db, a.shopId, a.token, confirmation({ TransID: 'STKRECEIPT1', TransAmount: '70' }))).toBe('stk');
  });
});

describe('the inbox', () => {
  it('matches a payment to a recorded sale of the same amount, or sets it aside', async () => {
    // A sale recorded long ago (outside the window): only the owner can pair them.
    const old = await recordSale(db, a.owner, { litres: 5000, paymentMethod: 'mpesa' }); // 350
    const c = confirmation({ TransAmount: '350', TransTime: '20260101080000' });
    expect(await handleC2bConfirmation(db, a.shopId, a.token, c)).toBe('unmatched');
    const row = await rowFor(String(c.TransID));
    expect((await salesForAmount(db, a.shopId, 35_000)).map((s) => s.id)).toContain(old.id);

    const wrong = await recordSale(db, a.owner, { litres: 1000, paymentMethod: 'mpesa', date: '2026-01-01' });
    await expect(matchToSale(db, a.owner, { c2bId: row.id, entryId: wrong.id })).rejects.toThrow('different amount');
    await matchToSale(db, a.owner, { c2bId: row.id, entryId: old.id });
    expect(await rowFor(String(c.TransID))).toMatchObject({ status: 'matched_sale', ledgerEntryId: old.id });

    const personal = confirmation({ TransAmount: '5000', TransTime: '20260101090000' });
    await handleC2bConfirmation(db, a.shopId, a.token, personal);
    const p = await rowFor(String(personal.TransID));
    await ignoreC2b(db, a.owner, { c2bId: p.id, note: 'School fees, not shop money' });
    expect(await rowFor(String(personal.TransID))).toMatchObject({ status: 'ignored', note: 'School fees, not shop money' });
  });

  it('puts the money back in the inbox when its sale is reversed', async () => {
    const c = confirmation({ TransAmount: '280.00' });
    const sale = await recordSale(db, a.seller, { litres: 4000, paymentMethod: 'mpesa' });
    expect(await handleC2bConfirmation(db, a.shopId, a.token, c)).toBe('matched_sale');
    await reverseEntry(db, a.owner, sale.id, 'typed the wrong litres');
    expect(await rowFor(String(c.TransID))).toMatchObject({ status: 'unmatched', ledgerEntryId: null });
  });
});

describe('daily reconciliation', () => {
  it('compares money received with M-Pesa in the books, and flags sales with no money', async () => {
    const today = darajaTimestamp(new Date()).slice(0, 8).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
    // A seller records an M-Pesa sale with no money behind it (yet).
    const ghost = await recordSale(db, a.seller, { litres: 6000, paymentMethod: 'mpesa' }); // 420
    const r = await getTillReconciliation(db, a.shopId, today);
    expect(r.connected).not.toBeNull();
    expect(r.received.length).toBeGreaterThan(0);
    expect(r.recorded.some((x) => x.id === ghost.id && !x.confirmedBy)).toBe(true);
    expect(r.openSales.some((s) => s.id === ghost.id)).toBe(true);
    // Within the matching window it is open, not yet flagged as unconfirmed.
    expect(r.totals.unconfirmed.some((s) => s.id === ghost.id)).toBe(false);
    expect(r.totals.receivedCents).toBe(r.received.filter((x) => x.status !== 'ignored').reduce((n, x) => n + x.amountCents, 0));
    expect(r.inbox.every((x) => x.transId)).toBe(true);
  });
});

describe('tenant isolation', () => {
  it("never lets one shop see or match another shop's payments", async () => {
    const c = confirmation({ TransAmount: '90' });
    await handleC2bConfirmation(db, a.shopId, a.token, c);
    const row = await rowFor(String(c.TransID));
    await expect(matchToCustomer(db, b.owner, { c2bId: row.id, customerId: jane.id })).rejects.toThrow('Payment not found');
    await expect(ignoreC2b(db, b.owner, { c2bId: row.id, note: 'x' })).rejects.toThrow('Payment not found');
    const r = await getTillReconciliation(db, b.shopId, row.businessDate);
    expect(r.received).toHaveLength(0);
    expect(r.inbox).toHaveLength(0);
    // A's shortcode sent to B's URL is ignored.
    expect(await handleC2bConfirmation(db, b.shopId, b.token, confirmation({}))).toBe('ignored');
  });
});
