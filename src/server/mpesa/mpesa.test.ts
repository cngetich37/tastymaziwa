/**
 * M-Pesa STK Push against a fake Daraja (injected fetch): the client, the
 * credential encryption, and the whole prompt → callback → ledger flow on a
 * real (in-memory) Postgres.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createDb, migrateDb, type DB } from '@/db/client';
import { ledgerEntries, mpesaRequests, mpesaSettings, shops, users } from '@/db/schema';
import { createCustomer, createProduct, setSalePrice, type Actor } from '../ledger';
import { decryptSecret, encryptSecret } from './crypto';
import { accessToken, darajaPassword, darajaTimestamp, parseStkCallback, stkPush, stkQuery, type DarajaCredentials } from './daraja';
import {
  getMpesaSettingsSummary,
  handleMpesaCallback,
  listMpesaRequests,
  refreshMpesaRequest,
  saveMpesaSettings,
  startMpesaCustomerPayment,
  startMpesaSale,
} from './payments';

// --- a fake Daraja ----------------------------------------------------------------------

interface Call {
  url: string;
  body: Record<string, unknown> | null;
}

function fakeDaraja(opts: { push?: () => object; query?: () => object; tokenStatus?: number } = {}) {
  const calls: Call[] = [];
  let n = 0;
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ url, body });
    const json = (data: object, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
    if (url.includes('/oauth/v1/generate')) {
      return opts.tokenStatus ? json({ errorMessage: 'Invalid credentials' }, opts.tokenStatus) : json({ access_token: `tok-${++n}`, expires_in: '3599' });
    }
    if (url.includes('/stkpush/v1/processrequest')) {
      n += 1;
      return json(opts.push?.() ?? { MerchantRequestID: `m-${n}`, CheckoutRequestID: `ws_CO_${n}_${Math.random().toString(36).slice(2)}`, ResponseCode: '0', ResponseDescription: 'Success' });
    }
    if (url.includes('/stkpushquery/v1/query')) {
      return json(opts.query?.() ?? { errorCode: '500.001.1001', errorMessage: 'The transaction is being processed' }, 500);
    }
    return json({}, 404);
  }) as typeof fetch;
  return { impl, calls };
}

const callback = (checkoutRequestId: string, resultCode: number, amount?: number, receipt = 'TKA1B2C3D4') => ({
  Body: {
    stkCallback: {
      MerchantRequestID: 'm',
      CheckoutRequestID: checkoutRequestId,
      ResultCode: resultCode,
      ResultDesc: resultCode === 0 ? 'The service request is processed successfully.' : 'Request cancelled by user',
      ...(resultCode === 0
        ? {
            CallbackMetadata: {
              Item: [
                { Name: 'Amount', Value: amount },
                { Name: 'MpesaReceiptNumber', Value: receipt },
                { Name: 'TransactionDate', Value: 20261115101500 },
                { Name: 'PhoneNumber', Value: 254712345678 },
              ],
            },
          }
        : {}),
    },
  },
});

/** The secret in the callback URL Daraja was given. */
const tokenFrom = (calls: Call[]) => {
  const push = calls.filter((c) => c.url.includes('processrequest')).at(-1)!;
  return String(push.body!.CallBackURL).split('/').at(-1)!;
};

const creds: DarajaCredentials = {
  environment: 'sandbox',
  shortcodeType: 'paybill',
  businessShortcode: '174379',
  tillNumber: null,
  consumerKey: 'key',
  consumerSecret: 'secret',
  passkey: 'passkey',
};

// --- unit: client and crypto ----------------------------------------------------------------

describe('Daraja client', () => {
  it('builds the timestamp in Nairobi time and the password from it', () => {
    const at = new Date('2026-11-15T07:05:09Z'); // 10:05:09 in Nairobi
    expect(darajaTimestamp(at)).toBe('20261115100509');
    expect(darajaPassword('174379', 'pk', '20261115100509')).toBe(Buffer.from('174379pk20261115100509').toString('base64'));
  });

  it('caches the token and sends paybill and till prompts correctly', async () => {
    const d = fakeDaraja();
    const unique = { ...creds, consumerKey: `k-${Math.random()}` };
    await stkPush(unique, { amountShillings: 140, phone: '+254712345678', callbackUrl: 'https://x/cb', accountReference: 'Duka la Maziwa', description: 'Milk' }, d.impl);
    await stkPush(
      { ...unique, shortcodeType: 'till', businessShortcode: '600000', tillNumber: '5123456' },
      { amountShillings: 70, phone: '+254712345678', callbackUrl: 'https://x/cb', accountReference: 'Duka', description: 'Milk' },
      d.impl,
    );
    expect(d.calls.filter((c) => c.url.includes('oauth'))).toHaveLength(1);
    const [paybill, till] = d.calls.filter((c) => c.url.includes('processrequest')).map((c) => c.body!);
    expect(paybill).toMatchObject({
      BusinessShortCode: '174379',
      TransactionType: 'CustomerPayBillOnline',
      Amount: 140,
      PartyA: '254712345678',
      PartyB: '174379',
      PhoneNumber: '254712345678',
      AccountReference: 'Duka la Mazi',
    });
    expect(String(paybill.AccountReference)).toHaveLength(12);
    expect(till).toMatchObject({ BusinessShortCode: '600000', TransactionType: 'CustomerBuyGoodsOnline', PartyB: '5123456' });
  });

  it('refuses bad credentials and fractional amounts', async () => {
    await expect(accessToken({ ...creds, consumerKey: `bad-${Math.random()}` }, fakeDaraja({ tokenStatus: 400 }).impl)).rejects.toThrow(
      'rejected the consumer key',
    );
    await expect(
      stkPush(creds, { amountShillings: 1.5, phone: '+254712345678', callbackUrl: 'x', accountReference: 'a', description: 'b' }, fakeDaraja().impl),
    ).rejects.toThrow('whole-shilling');
  });

  it('reads the query result: still processing, paid or not', async () => {
    expect(await stkQuery(creds, 'ws', fakeDaraja().impl)).toEqual({ state: 'pending' });
    expect(await stkQuery(creds, 'ws', fakeDaraja({ query: () => ({ ResultCode: '0', ResultDesc: 'ok' }) }).impl)).toMatchObject({ state: 'succeeded' });
    expect(await stkQuery(creds, 'ws', fakeDaraja({ query: () => ({ ResultCode: '1032', ResultDesc: 'Cancelled' }) }).impl)).toMatchObject({
      state: 'failed',
      resultCode: 1032,
    });
  });

  it('parses callbacks defensively', () => {
    expect(parseStkCallback(callback('ws_1', 0, 140))).toMatchObject({ checkoutRequestId: 'ws_1', resultCode: 0, amountShillings: 140, receiptNumber: 'TKA1B2C3D4' });
    expect(parseStkCallback(callback('ws_1', 1032))).toMatchObject({ resultCode: 1032, amountShillings: null, receiptNumber: null });
    expect(parseStkCallback({ hello: 'world' })).toBeNull();
    expect(parseStkCallback(callback('ws_1', 0, 1, '<script>'))!.receiptNumber).toBeNull();
  });
});

describe('credential encryption', () => {
  it('round-trips and rejects tampering', () => {
    const sealed = encryptSecret('super-secret');
    expect(sealed).not.toContain('super-secret');
    expect(decryptSecret(sealed)).toBe('super-secret');
    const parts = sealed.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => decryptSecret(parts.join('.'))).toThrow();
  });
});

// --- integration: the counter flow ------------------------------------------------------------

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
  await setSalePrice(db, owner, 7000);
  return { shopId: shop.id, owner, seller };
}

const settings = {
  enabled: true,
  environment: 'sandbox' as const,
  shortcodeType: 'paybill' as const,
  businessShortcode: '174379',
  accountReference: 'TastyMaziwa',
  consumerKey: 'ck',
  consumerSecret: 'cs',
  passkey: 'pk',
};

let a: Awaited<ReturnType<typeof makeShop>>;
let b: Awaited<ReturnType<typeof makeShop>>;

beforeAll(async () => {
  process.env.AUTH_SECRET ??= 'test-secret-for-mpesa';
  process.env.APP_URL = 'https://duka.example';
  ({ db, close } = await createDb({ pgliteDir: 'memory://' }));
  await migrateDb(db);
  a = await makeShop('A');
  b = await makeShop('B');
});

afterAll(() => close());

const ledgerFor = (shopId: string) => db.select().from(ledgerEntries).where(eq(ledgerEntries.shopId, shopId));
const requestRow = async (id: string) => (await db.select().from(mpesaRequests).where(eq(mpesaRequests.id, id)))[0];

describe('settings', () => {
  it('needs every secret the first time, stores them encrypted and never shows them', async () => {
    await expect(saveMpesaSettings(db, a.owner, { ...settings, passkey: undefined })).rejects.toThrow('Enter the passkey');
    await expect(saveMpesaSettings(db, a.seller, settings)).rejects.toThrow('Only the owner');
    await saveMpesaSettings(db, a.owner, settings);
    // Later saves can leave the secrets blank to keep them.
    await saveMpesaSettings(db, a.owner, { ...settings, accountReference: 'Duka', consumerKey: undefined, consumerSecret: undefined, passkey: undefined });
    const [row] = await db.select().from(mpesaSettings).where(eq(mpesaSettings.shopId, a.shopId));
    expect(row.consumerKeyEnc).not.toContain('ck');
    expect(decryptSecret(row.passkeyEnc)).toBe('pk');
    const summary = await getMpesaSettingsSummary(db, a.shopId);
    expect(JSON.stringify(summary)).not.toMatch(/consumer|passkey|Enc/);
    expect(summary?.accountReference).toBe('Duka');
  });
});

describe('sale by M-Pesa prompt', () => {
  it('records nothing until M-Pesa confirms, then the sale exactly once', async () => {
    const d = fakeDaraja();
    const mala = await createProduct(db, a.owner, { name: 'Mala', unit: 'piece', salePrice: 6000 });
    const { requestId } = await startMpesaSale(db, a.seller, { litres: 2000, productId: mala.id, phone: '+254712345678' }, d.impl);
    const push = d.calls.find((c) => c.url.includes('processrequest'))!.body!;
    expect(push).toMatchObject({ Amount: 120 });
    expect(String(push.CallBackURL)).toMatch(new RegExp(`^https://duka\\.example/api/mpesa/callback/${requestId}/[\\w-]{20,}$`));
    expect(await ledgerFor(a.shopId)).toHaveLength(0);

    const pending = await requestRow(requestId);
    const token = tokenFrom(d.calls);
    // A forged callback (wrong secret) changes nothing.
    expect(await handleMpesaCallback(db, requestId, 'not-the-secret', callback(pending.checkoutRequestId!, 0, 120))).toBe('ignored');
    // Nor does one for another prompt.
    expect(await handleMpesaCallback(db, requestId, token, callback('ws_other', 0, 120))).toBe('ignored');
    expect(await ledgerFor(a.shopId)).toHaveLength(0);

    expect(await handleMpesaCallback(db, requestId, token, callback(pending.checkoutRequestId!, 0, 120))).toBe('posted');
    // Safaricom retries: the second callback is a no-op.
    expect(await handleMpesaCallback(db, requestId, token, callback(pending.checkoutRequestId!, 0, 120))).toBe('ignored');

    const entries = await ledgerFor(a.shopId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: 'sale',
      paymentMethod: 'mpesa',
      productId: mala.id,
      volumeMl: 2000,
      unitPriceCents: 6000,
      amountCents: 12_000,
      createdBy: a.seller.id,
      note: 'M-Pesa TKA1B2C3D4',
    });
    expect(await requestRow(requestId)).toMatchObject({ status: 'succeeded', receiptNumber: 'TKA1B2C3D4', ledgerEntryId: entries[0].id });
    expect(await refreshMpesaRequest(db, a.seller, requestId, d.impl)).toMatchObject({ status: 'succeeded', message: 'Paid · TKA1B2C3D4' });
  });

  it('marks cancelled and short-paid prompts failed, posting nothing', async () => {
    const d = fakeDaraja();
    const cancelled = await startMpesaSale(db, a.seller, { litres: 1000, phone: '+254711111111' }, d.impl);
    const r1 = await requestRow(cancelled.requestId);
    expect(await handleMpesaCallback(db, r1.id, tokenFrom(d.calls), callback(r1.checkoutRequestId!, 1032))).toBe('failed');
    expect(await refreshMpesaRequest(db, a.seller, r1.id, d.impl)).toMatchObject({ status: 'failed', message: 'The customer cancelled the prompt' });

    const short = await startMpesaSale(db, a.seller, { litres: 1000, phone: '+254722222222' }, d.impl);
    const r2 = await requestRow(short.requestId);
    expect(await handleMpesaCallback(db, r2.id, tokenFrom(d.calls), callback(r2.checkoutRequestId!, 0, 1))).toBe('failed');
    expect((await requestRow(r2.id)).resultDesc).toMatch(/Amount mismatch/);
    expect((await ledgerFor(a.shopId)).filter((e) => e.amountCents === 7000)).toHaveLength(0);
  });

  it('blocks a double tap, non-whole shillings and prompts M-Pesa refuses', async () => {
    const d = fakeDaraja();
    await startMpesaSale(db, a.seller, { litres: 1000, phone: '+254733333333' }, d.impl);
    await expect(startMpesaSale(db, a.seller, { litres: 1000, phone: '+254733333333' }, d.impl)).rejects.toThrow('just sent to this phone');
    await expect(startMpesaSale(db, a.seller, { litres: 1250, phone: '+254744444444' }, d.impl)).rejects.toThrow('whole shillings');

    const refused = fakeDaraja({ push: () => ({ errorCode: '400.002.02', errorMessage: 'Bad Request - Invalid PhoneNumber' }) });
    await expect(startMpesaSale(db, a.seller, { litres: 1000, phone: '+254755555555' }, refused.impl)).rejects.toThrow('Invalid PhoneNumber');
    const [latest] = await listMpesaRequests(db, a.shopId, 1);
    expect(latest).toMatchObject({ status: 'failed', phone: '+254755555555' });
  });

  it('settles from a status query when the callback never comes', async () => {
    const paid = fakeDaraja({ query: () => ({ ResultCode: '0', ResultDesc: 'The service request is processed successfully.' }) });
    const { requestId } = await startMpesaSale(db, a.seller, { litres: 3000, phone: '+254766666666' }, paid.impl);
    // Young prompts aren't queried yet.
    expect(await refreshMpesaRequest(db, a.seller, requestId, paid.impl)).toMatchObject({ status: 'pending' });
    expect(paid.calls.some((c) => c.url.includes('stkpushquery'))).toBe(false);
    await db.update(mpesaRequests).set({ createdAt: new Date(Date.now() - 60_000) }).where(eq(mpesaRequests.id, requestId));
    expect(await refreshMpesaRequest(db, a.seller, requestId, paid.impl)).toMatchObject({ status: 'succeeded' });
    // A late callback after the query settled it posts nothing more.
    const r = await requestRow(requestId);
    expect(await handleMpesaCallback(db, requestId, tokenFrom(paid.calls), callback(r.checkoutRequestId!, 0, 210))).toBe('ignored');
    const posted = await db
      .select()
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.shopId, a.shopId), eq(ledgerEntries.idempotencyKey, `mpesa:${requestId}`)));
    expect(posted).toHaveLength(1);
  });
});

describe('customer payment by M-Pesa prompt', () => {
  it("is the owner's, and posts a payment against the customer's deni", async () => {
    const d = fakeDaraja();
    const jane = await createCustomer(db, a.owner, { name: 'Jane', phone: '+254777777777' });
    await expect(
      startMpesaCustomerPayment(db, a.seller, { customerId: jane.id, amount: 50_000, phone: '+254777777777' }, d.impl),
    ).rejects.toThrow('Only the owner');
    const { requestId } = await startMpesaCustomerPayment(db, a.owner, { customerId: jane.id, amount: 50_000, phone: '+254777777777' }, d.impl);
    const r = await requestRow(requestId);
    await handleMpesaCallback(db, requestId, tokenFrom(d.calls), callback(r.checkoutRequestId!, 0, 500, 'TKB9Z8Y7X6'));
    const [entry] = await db.select().from(ledgerEntries).where(eq(ledgerEntries.idempotencyKey, `mpesa:${requestId}`));
    expect(entry).toMatchObject({ kind: 'customer_payment', paymentMethod: 'mpesa', customerId: jane.id, amountCents: 50_000 });
  });
});

describe('tenant isolation', () => {
  it("never lets one shop read, settle or use another shop's prompts or settings", async () => {
    const [aRequest] = await listMpesaRequests(db, a.shopId, 1);
    await expect(refreshMpesaRequest(db, b.seller, aRequest.id)).rejects.toThrow('not found');
    expect(await listMpesaRequests(db, b.shopId)).toHaveLength(0);
    // B has no M-Pesa set up: A's credentials are never used for B.
    await expect(startMpesaSale(db, b.seller, { litres: 1000, phone: '+254788888888' }, fakeDaraja().impl)).rejects.toThrow('not set up');
    expect(await getMpesaSettingsSummary(db, b.shopId)).toBeNull();
  });
});
