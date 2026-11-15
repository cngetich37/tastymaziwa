/**
 * Safaricom Daraja (Lipa na M-Pesa Online / M-Pesa Express) client: OAuth
 * token, STK Push and STK Push query. One shop's credentials per call.
 *
 * `fetch` is injectable so tests never touch the network.
 */
import { createHash } from 'node:crypto';

export interface DarajaCredentials {
  environment: 'sandbox' | 'production';
  shortcodeType: 'paybill' | 'till';
  /** Paybill number, or the till's head office (store) number. */
  businessShortcode: string;
  tillNumber: string | null;
  consumerKey: string;
  consumerSecret: string;
  passkey: string;
}

export class DarajaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DarajaError';
  }
}

type Fetch = typeof fetch;

export const DARAJA_HOSTS = {
  sandbox: 'https://sandbox.safaricom.co.ke',
  production: 'https://api.safaricom.co.ke',
} as const;

const TIMEOUT_MS = 15_000;

/** Tokens last ~1 hour; reuse until a minute before expiry. Per server instance. */
const tokens: Map<string, { token: string; expiresAt: number }> = ((globalThis as Record<string, unknown>).__darajaTokens ??=
  new Map()) as Map<string, { token: string; expiresAt: number }>;

const tokenKey = (c: DarajaCredentials) =>
  createHash('sha256').update(`${c.environment}:${c.consumerKey}:${c.consumerSecret}`).digest('base64url');

export async function accessToken(c: DarajaCredentials, fetchImpl: Fetch = fetch, now = Date.now()): Promise<string> {
  const cached = tokens.get(tokenKey(c));
  if (cached && cached.expiresAt > now) return cached.token;
  const res = await fetchImpl(`${DARAJA_HOSTS[c.environment]}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${Buffer.from(`${c.consumerKey}:${c.consumerSecret}`).toString('base64')}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: string | number } | null;
  if (!res.ok || !body?.access_token) {
    throw new DarajaError('M-Pesa rejected the consumer key or secret. Check them in Settings.');
  }
  const ttl = Number(body.expires_in ?? 3599);
  tokens.set(tokenKey(c), { token: body.access_token, expiresAt: now + Math.max(60, ttl - 60) * 1000 });
  return body.access_token;
}

/** Forget a shop's token (after its credentials change). */
export const clearToken = (c: DarajaCredentials) => tokens.delete(tokenKey(c));

/** Nairobi time as YYYYMMDDHHmmss, as Daraja expects. */
export function darajaTimestamp(at = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}${get('month')}${get('day')}${get('hour')}${get('minute')}${get('second')}`;
}

export const darajaPassword = (shortcode: string, passkey: string, timestamp: string) =>
  Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');

/** +254712345678 → 254712345678 */
export const darajaPhone = (e164: string) => e164.replace(/^\+/, '');

async function post<T>(c: DarajaCredentials, path: string, payload: object, fetchImpl: Fetch): Promise<{ ok: boolean; body: T | null }> {
  const token = await accessToken(c, fetchImpl);
  const res = await fetchImpl(`${DARAJA_HOSTS[c.environment]}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return { ok: res.ok, body: (await res.json().catch(() => null)) as T | null };
}

export interface StkPushInput {
  amountShillings: number;
  phone: string;
  callbackUrl: string;
  /** 12 characters at most. */
  accountReference: string;
  /** 13 characters at most. */
  description: string;
}

/** Send the PIN prompt. Resolves with Daraja's ids once M-Pesa has accepted the request. */
export async function stkPush(c: DarajaCredentials, input: StkPushInput, fetchImpl: Fetch = fetch, at = new Date()) {
  if (!Number.isSafeInteger(input.amountShillings) || input.amountShillings < 1) {
    throw new DarajaError('M-Pesa prompts need a whole-shilling amount');
  }
  const timestamp = darajaTimestamp(at);
  const phone = darajaPhone(input.phone);
  const { ok, body } = await post<{
    ResponseCode?: string;
    CheckoutRequestID?: string;
    MerchantRequestID?: string;
    errorMessage?: string;
    ResponseDescription?: string;
  }>(
    c,
    '/mpesa/stkpush/v1/processrequest',
    {
      BusinessShortCode: c.businessShortcode,
      Password: darajaPassword(c.businessShortcode, c.passkey, timestamp),
      Timestamp: timestamp,
      TransactionType: c.shortcodeType === 'till' ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline',
      Amount: input.amountShillings,
      PartyA: phone,
      PartyB: c.shortcodeType === 'till' ? (c.tillNumber ?? c.businessShortcode) : c.businessShortcode,
      PhoneNumber: phone,
      CallBackURL: input.callbackUrl,
      AccountReference: input.accountReference.slice(0, 12),
      TransactionDesc: input.description.slice(0, 13),
    },
    fetchImpl,
  );
  if (!ok || body?.ResponseCode !== '0' || !body.CheckoutRequestID) {
    throw new DarajaError(body?.errorMessage ?? body?.ResponseDescription ?? 'M-Pesa did not accept the request');
  }
  return { checkoutRequestId: body.CheckoutRequestID, merchantRequestId: body.MerchantRequestID ?? null };
}

export type StkQueryResult =
  | { state: 'pending' }
  | { state: 'succeeded'; resultCode: 0; resultDesc: string }
  | { state: 'failed'; resultCode: number; resultDesc: string };

/** Ask M-Pesa how a prompt ended, for when the callback never arrives. */
export async function stkQuery(c: DarajaCredentials, checkoutRequestId: string, fetchImpl: Fetch = fetch, at = new Date()): Promise<StkQueryResult> {
  const timestamp = darajaTimestamp(at);
  const { body } = await post<{ ResultCode?: string | number; ResultDesc?: string; errorCode?: string }>(
    c,
    '/mpesa/stkpushquery/v1/query',
    {
      BusinessShortCode: c.businessShortcode,
      Password: darajaPassword(c.businessShortcode, c.passkey, timestamp),
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    },
    fetchImpl,
  );
  // While the customer is still deciding, Daraja answers with an error ("being processed").
  if (body?.ResultCode === undefined || body.ResultCode === null || body.ResultCode === '') return { state: 'pending' };
  const code = Number(body.ResultCode);
  if (!Number.isFinite(code)) return { state: 'pending' };
  return code === 0
    ? { state: 'succeeded', resultCode: 0, resultDesc: body.ResultDesc ?? 'Paid' }
    : { state: 'failed', resultCode: code, resultDesc: body.ResultDesc ?? 'Not paid' };
}

/** What a customer-facing failure means, in plain words. */
export function describeResult(code: number | null, fallback?: string | null): string {
  switch (code) {
    case 0:
      return 'Paid';
    case 1:
      return 'Not enough money in the M-Pesa account';
    case 1032:
      return 'The customer cancelled the prompt';
    case 1037:
      return "The customer's phone couldn't be reached, or the prompt timed out";
    case 2001:
      return 'Wrong M-Pesa PIN';
    case 1001:
      return 'The customer is busy with another M-Pesa transaction';
    default:
      return fallback ?? 'Not paid';
  }
}

export interface StkCallback {
  merchantRequestId: string | null;
  checkoutRequestId: string;
  resultCode: number;
  resultDesc: string;
  amountShillings: number | null;
  receiptNumber: string | null;
  phone: string | null;
}

/** Read Daraja's callback body; null if it isn't one. Never trusts it beyond shape. */
export function parseStkCallback(body: unknown): StkCallback | null {
  const cb = (body as { Body?: { stkCallback?: Record<string, unknown> } } | null)?.Body?.stkCallback;
  if (!cb || typeof cb.CheckoutRequestID !== 'string') return null;
  const items = ((cb.CallbackMetadata as { Item?: { Name?: string; Value?: unknown }[] } | undefined)?.Item ?? []).filter(
    (i) => i && typeof i.Name === 'string',
  );
  const item = (name: string) => items.find((i) => i.Name === name)?.Value;
  const amount = Number(item('Amount'));
  const receipt = item('MpesaReceiptNumber');
  const phone = item('PhoneNumber');
  return {
    merchantRequestId: typeof cb.MerchantRequestID === 'string' ? cb.MerchantRequestID : null,
    checkoutRequestId: cb.CheckoutRequestID,
    resultCode: Number(cb.ResultCode),
    resultDesc: typeof cb.ResultDesc === 'string' ? cb.ResultDesc : '',
    amountShillings: Number.isFinite(amount) ? amount : null,
    receiptNumber: typeof receipt === 'string' && /^[A-Z0-9]{6,20}$/.test(receipt) ? receipt : null,
    phone: phone != null ? String(phone) : null,
  };
}

// --- C2B: payments made straight to the till / paybill ----------------------------------

/**
 * Register where Safaricom sends till/paybill payments (C2B v2). Done once per
 * shortcode; registering again replaces the URLs. "Completed" means payments
 * still go through if our validation URL is down.
 */
export async function registerC2bUrls(
  c: DarajaCredentials,
  urls: { confirmationUrl: string; validationUrl: string },
  fetchImpl: Fetch = fetch,
) {
  const { ok, body } = await post<{ ResponseCode?: string; ResponseDescription?: string; errorMessage?: string }>(
    c,
    '/mpesa/c2b/v2/registerurl',
    {
      ShortCode: c.businessShortcode,
      ResponseType: 'Completed',
      ConfirmationURL: urls.confirmationUrl,
      ValidationURL: urls.validationUrl,
    },
    fetchImpl,
  );
  const code = body?.ResponseCode;
  if (!ok || (code !== undefined && code !== '0' && code !== '00000000')) {
    throw new DarajaError(body?.errorMessage ?? body?.ResponseDescription ?? 'M-Pesa did not register the till');
  }
}

/** Sandbox only: make a pretend customer payment to the shortcode, to test reconciliation. */
export async function simulateC2b(
  c: DarajaCredentials,
  input: { amountShillings: number; phone: string; billRef: string },
  fetchImpl: Fetch = fetch,
) {
  if (c.environment !== 'sandbox') throw new DarajaError('Test payments only work in sandbox mode');
  const { ok, body } = await post<{ ResponseCode?: string; ResponseDescription?: string; errorMessage?: string }>(
    c,
    '/mpesa/c2b/v1/simulate',
    {
      ShortCode: c.businessShortcode,
      CommandID: c.shortcodeType === 'till' ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline',
      Amount: input.amountShillings,
      Msisdn: darajaPhone(input.phone),
      BillRefNumber: c.shortcodeType === 'till' ? '' : input.billRef,
    },
    fetchImpl,
  );
  if (!ok || (body?.ResponseCode !== undefined && body.ResponseCode !== '0')) {
    throw new DarajaError(body?.errorMessage ?? body?.ResponseDescription ?? 'M-Pesa did not accept the test payment');
  }
}

export interface C2bConfirmation {
  transId: string;
  transType: string | null;
  transTime: string | null;
  amount: unknown;
  businessShortcode: string;
  billRef: string | null;
  msisdn: string | null;
  payerName: string | null;
  orgBalance: unknown;
}

/** Read a C2B confirmation body; null unless it has the fields that matter. */
export function parseC2bConfirmation(body: unknown): C2bConfirmation | null {
  const b = body as Record<string, unknown> | null;
  if (!b || typeof b !== 'object') return null;
  const str = (k: string) => (b[k] === undefined || b[k] === null ? null : String(b[k]).trim() || null);
  const transId = str('TransID');
  const shortcode = str('BusinessShortCode');
  if (!transId || !/^[A-Z0-9]{6,20}$/.test(transId) || !shortcode) return null;
  const name = ['FirstName', 'MiddleName', 'LastName'].map(str).filter(Boolean).join(' ');
  return {
    transId,
    transType: str('TransactionType'),
    transTime: str('TransTime'),
    amount: b.TransAmount,
    businessShortcode: shortcode,
    billRef: str('BillRefNumber'),
    msisdn: str('MSISDN'),
    payerName: name ? name.slice(0, 80) : null,
    orgBalance: b.OrgAccountBalance,
  };
}
