/**
 * Lipa na M-Pesa (STK Push) for the counter.
 *
 * 1. `startMpesaSale` / `startMpesaCustomerPayment` price the sale by the
 *    usual rules, store a pending request, and send the PIN prompt.
 * 2. Safaricom POSTs the outcome to `/api/payments/stk/<id>/<secret>`;
 *    `handleMpesaCallback` checks the secret, the CheckoutRequestID and the
 *    amount, then posts the sale/payment to the ledger once.
 * 3. If the callback never comes, `refreshMpesaRequest` asks Daraja.
 *
 * Nothing reaches the ledger until M-Pesa confirms the money moved.
 */
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { DB } from '@/db/client';
import { auditLog, customers, mpesaRequests, mpesaSettings, products, shops, users, type MpesaRequest } from '@/db/schema';
import { todayBusinessDate } from '@/lib/dates';
import { formatKES } from '@/lib/money';
import type { MpesaCustomerPaymentInput, MpesaSaleInput, MpesaSettingsInput } from '@/lib/validation';
import { appUrl } from '../auth/config';
import { DomainError, assertCustomer, postMpesaRequest, quoteSale, type Actor } from '../ledger';
import { callbackTokenMatches, decryptSecret, encryptSecret, hashCallbackToken, newCallbackToken } from './crypto';
import {
  DarajaError,
  clearToken,
  describeResult,
  parseStkCallback,
  stkPush,
  stkQuery,
  type DarajaCredentials,
} from './daraja';

type Fetch = typeof fetch;

/** One prompt per phone at a time: a second tap waits for the first to finish. */
const PENDING_WINDOW_SECONDS = 90;
/** After this, a pending prompt is checked with Daraja when someone asks. */
const QUERY_AFTER_SECONDS = 20;

// --- settings -----------------------------------------------------------------------

/** What the Settings page may show: never the secrets themselves. */
export async function getMpesaSettingsSummary(db: DB, shopId: string) {
  const [row] = await db.select().from(mpesaSettings).where(eq(mpesaSettings.shopId, shopId));
  if (!row) return null;
  return {
    enabled: row.enabled,
    environment: row.environment,
    shortcodeType: row.shortcodeType,
    businessShortcode: row.businessShortcode,
    tillNumber: row.tillNumber,
    accountReference: row.accountReference,
    updatedAt: row.updatedAt,
  };
}

/** Whether the counter can send prompts (enabled and set up). */
export async function mpesaReady(db: DB, shopId: string): Promise<boolean> {
  const [row] = await db
    .select({ enabled: mpesaSettings.enabled })
    .from(mpesaSettings)
    .where(eq(mpesaSettings.shopId, shopId));
  return row?.enabled === true;
}

async function credentials(db: DB, shopId: string): Promise<{ creds: DarajaCredentials; accountReference: string }> {
  const [row] = await db.select().from(mpesaSettings).where(eq(mpesaSettings.shopId, shopId));
  if (!row || !row.enabled) throw new DomainError('M-Pesa prompts are not set up. The owner can add them in Settings.');
  return {
    accountReference: row.accountReference,
    creds: {
      environment: row.environment,
      shortcodeType: row.shortcodeType,
      businessShortcode: row.businessShortcode,
      tillNumber: row.tillNumber,
      consumerKey: decryptSecret(row.consumerKeyEnc),
      consumerSecret: decryptSecret(row.consumerSecretEnc),
      passkey: decryptSecret(row.passkeyEnc),
    },
  };
}

export async function saveMpesaSettings(db: DB, actor: Actor, input: MpesaSettingsInput) {
  if (actor.role !== 'owner') throw new DomainError('Only the owner sets up M-Pesa');
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(mpesaSettings).where(eq(mpesaSettings.shopId, actor.shopId));
    const secret = (fresh: string | undefined, saved: string | undefined, label: string) => {
      if (fresh) return encryptSecret(fresh);
      if (saved) return saved;
      throw new DomainError(`Enter the ${label}`);
    };
    const values = {
      enabled: input.enabled,
      environment: input.environment,
      shortcodeType: input.shortcodeType,
      businessShortcode: input.businessShortcode,
      tillNumber: input.shortcodeType === 'till' ? (input.tillNumber ?? null) : null,
      accountReference: input.accountReference,
      consumerKeyEnc: secret(input.consumerKey, existing?.consumerKeyEnc, 'consumer key'),
      consumerSecretEnc: secret(input.consumerSecret, existing?.consumerSecretEnc, 'consumer secret'),
      passkeyEnc: secret(input.passkey, existing?.passkeyEnc, 'passkey'),
      updatedAt: sql`now()`,
    };
    await tx
      .insert(mpesaSettings)
      .values({ shopId: actor.shopId, ...values })
      .onConflictDoUpdate({ target: mpesaSettings.shopId, set: values });
    if (existing) {
      clearToken({
        environment: existing.environment,
        shortcodeType: existing.shortcodeType,
        businessShortcode: existing.businessShortcode,
        tillNumber: existing.tillNumber,
        consumerKey: decryptSecret(existing.consumerKeyEnc),
        consumerSecret: decryptSecret(existing.consumerSecretEnc),
        passkey: '',
      });
    }
    await tx.insert(auditLog).values({
      shopId: actor.shopId,
      userId: actor.id,
      action: 'mpesa.settings',
      entityType: 'shop',
      entityId: actor.shopId,
      // Never the secrets; only which ones changed.
      data: {
        environment: input.environment,
        shortcodeType: input.shortcodeType,
        businessShortcode: input.businessShortcode,
        tillNumber: input.tillNumber ?? null,
        enabled: input.enabled,
        changed: ['consumerKey', 'consumerSecret', 'passkey'].filter((k) => input[k as keyof MpesaSettingsInput]),
      },
    });
  });
}

// --- sending prompts ------------------------------------------------------------------

function assertStaff(actor: Actor) {
  if (actor.role !== 'owner' && actor.role !== 'attendant') throw new DomainError('Only shop staff can send M-Pesa prompts');
}

async function send(
  db: DB,
  actor: Actor,
  values: Omit<typeof mpesaRequests.$inferInsert, 'shopId' | 'callbackTokenHash' | 'businessDate' | 'createdBy'>,
  fetchImpl: Fetch,
) {
  if (values.amountCents % 100 !== 0) {
    throw new DomainError(`M-Pesa prompts are for whole shillings; ${formatKES(values.amountCents)} isn't. Adjust the litres or price.`);
  }
  const { creds, accountReference } = await credentials(db, actor.shopId);
  const token = newCallbackToken();

  const request = await db.transaction(async (tx) => {
    // Serialise prompts per shop so the double-tap check can't race.
    await tx.select({ id: shops.id }).from(shops).where(eq(shops.id, actor.shopId)).for('update');
    const [busy] = await tx
      .select({ id: mpesaRequests.id })
      .from(mpesaRequests)
      .where(
        and(
          eq(mpesaRequests.shopId, actor.shopId),
          eq(mpesaRequests.phone, values.phone),
          eq(mpesaRequests.status, 'pending'),
          gt(mpesaRequests.createdAt, sql`now() - make_interval(secs => ${PENDING_WINDOW_SECONDS})`),
        ),
      );
    if (busy) throw new DomainError('A prompt was just sent to this phone. Wait for the customer to answer it.');
    const [row] = await tx
      .insert(mpesaRequests)
      .values({
        ...values,
        shopId: actor.shopId,
        businessDate: todayBusinessDate(),
        callbackTokenHash: hashCallbackToken(token),
        createdBy: actor.id,
      })
      .returning();
    await tx.insert(auditLog).values({
      shopId: actor.shopId,
      userId: actor.id,
      action: 'mpesa.request',
      entityType: 'mpesa_request',
      entityId: row.id,
      data: { purpose: row.purpose, amountCents: row.amountCents, phone: row.phone },
    });
    return row;
  });

  try {
    const sent = await stkPush(
      creds,
      {
        amountShillings: request.amountCents / 100,
        phone: request.phone,
        // No "mpesa" in the path: Daraja is reported to drop such callback URLs.
        callbackUrl: `${appUrl()}/api/payments/stk/${request.id}/${token}`,
        accountReference,
        description: request.purpose === 'sale' ? 'Milk' : 'Payment',
      },
      fetchImpl,
    );
    await db
      .update(mpesaRequests)
      .set({ checkoutRequestId: sent.checkoutRequestId, merchantRequestId: sent.merchantRequestId })
      .where(and(eq(mpesaRequests.id, request.id), eq(mpesaRequests.shopId, actor.shopId)));
    return { requestId: request.id };
  } catch (error) {
    const message = error instanceof DarajaError ? error.message : 'Could not reach M-Pesa. Check the connection and try again.';
    if (!(error instanceof DarajaError)) console.error('[mpesa] stk push failed', error);
    await db
      .update(mpesaRequests)
      .set({ status: 'failed', resultDesc: message, completedAt: sql`now()` })
      .where(and(eq(mpesaRequests.id, request.id), eq(mpesaRequests.shopId, actor.shopId)));
    throw new DomainError(message);
  }
}

/** A sale paid by prompt. Priced exactly like a counter sale; recorded only once paid. */
export async function startMpesaSale(db: DB, actor: Actor, input: MpesaSaleInput, fetchImpl: Fetch = fetch) {
  assertStaff(actor);
  const quote = await db.transaction(async (tx) => {
    if (input.customerId) await assertCustomer(tx, actor, input.customerId);
    return quoteSale(tx, actor, input);
  });
  return send(
    db,
    actor,
    {
      purpose: 'sale',
      amountCents: quote.amountCents,
      phone: input.phone,
      customerId: input.customerId ?? null,
      productId: quote.product?.id ?? null,
      volumeMl: input.litres,
      unitPriceCents: quote.price,
      note: input.note ?? null,
    },
    fetchImpl,
  );
}

/** A customer paying their deni by prompt (owners, as with any customer payment). */
export async function startMpesaCustomerPayment(
  db: DB,
  actor: Actor,
  input: MpesaCustomerPaymentInput,
  fetchImpl: Fetch = fetch,
) {
  if (actor.role !== 'owner') throw new DomainError('Only the owner records customer payments');
  await db.transaction((tx) => assertCustomer(tx, actor, input.customerId));
  return send(
    db,
    actor,
    { purpose: 'customer_payment', amountCents: input.amount, phone: input.phone, customerId: input.customerId },
    fetchImpl,
  );
}

// --- outcomes ---------------------------------------------------------------------------

/**
 * Settle a pending request: post it to the ledger if paid, or mark it failed.
 * Row-locked and status-checked, so duplicate callbacks and a racing status
 * check settle it exactly once.
 */
async function settle(
  db: DB,
  requestId: string,
  shopId: string,
  outcome: { paid: true; receiptNumber: string | null; resultDesc: string } | { paid: false; resultCode: number | null; resultDesc: string },
) {
  return db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(mpesaRequests)
      .where(and(eq(mpesaRequests.id, requestId), eq(mpesaRequests.shopId, shopId)))
      .for('update');
    if (!request || request.status !== 'pending') return request ?? null;
    if (outcome.paid) {
      const entry = await postMpesaRequest(tx, request, outcome.receiptNumber);
      const [done] = await tx
        .update(mpesaRequests)
        .set({
          status: 'succeeded',
          resultCode: 0,
          resultDesc: outcome.resultDesc,
          receiptNumber: outcome.receiptNumber,
          ledgerEntryId: entry.id,
          completedAt: sql`now()`,
        })
        .where(eq(mpesaRequests.id, request.id))
        .returning();
      return done;
    }
    const [done] = await tx
      .update(mpesaRequests)
      .set({ status: 'failed', resultCode: outcome.resultCode, resultDesc: outcome.resultDesc, completedAt: sql`now()` })
      .where(eq(mpesaRequests.id, request.id))
      .returning();
    return done;
  });
}

export type CallbackOutcome = 'posted' | 'failed' | 'ignored';

/**
 * Safaricom's callback. Unauthenticated by nature, so: the per-request secret
 * in the URL must match, the CheckoutRequestID must be the one we got, and a
 * success must be for exactly the amount asked. Anything else is ignored.
 */
export async function handleMpesaCallback(db: DB, requestId: string, token: string, body: unknown): Promise<CallbackOutcome> {
  const cb = parseStkCallback(body);
  if (!cb) return 'ignored';
  const [request] = await db.select().from(mpesaRequests).where(eq(mpesaRequests.id, requestId));
  if (!request || !callbackTokenMatches(token, request.callbackTokenHash)) return 'ignored';
  if (request.checkoutRequestId && request.checkoutRequestId !== cb.checkoutRequestId) return 'ignored';
  if (request.status !== 'pending') return 'ignored';

  if (cb.resultCode === 0) {
    if (cb.amountShillings == null || cb.amountShillings * 100 !== request.amountCents) {
      console.error('[mpesa] callback amount mismatch', { requestId, expected: request.amountCents, got: cb.amountShillings });
      await settle(db, request.id, request.shopId, {
        paid: false,
        resultCode: cb.resultCode,
        resultDesc: `Amount mismatch: asked ${formatKES(request.amountCents)}, M-Pesa reported ${cb.amountShillings ?? 'none'}. Check the M-Pesa statement.`,
      });
      return 'failed';
    }
    const done = await settle(db, request.id, request.shopId, {
      paid: true,
      receiptNumber: cb.receiptNumber,
      resultDesc: cb.resultDesc || 'Paid',
    });
    return done?.status === 'succeeded' ? 'posted' : 'ignored';
  }
  await settle(db, request.id, request.shopId, {
    paid: false,
    resultCode: cb.resultCode,
    resultDesc: describeResult(cb.resultCode, cb.resultDesc),
  });
  return 'failed';
}

export interface MpesaStatus {
  status: MpesaRequest['status'];
  receiptNumber: string | null;
  message: string;
}

const statusOf = (r: MpesaRequest): MpesaStatus => ({
  status: r.status,
  receiptNumber: r.receiptNumber,
  message:
    r.status === 'succeeded'
      ? `Paid${r.receiptNumber ? ` · ${r.receiptNumber}` : ''}`
      : r.status === 'failed'
        ? (r.resultDesc ?? describeResult(r.resultCode))
        : 'Waiting for the customer to enter their M-Pesa PIN…',
});

/**
 * The counter polls this while the customer answers. Once the prompt is a
 * little old, it asks Daraja directly, in case the callback was lost.
 */
export async function refreshMpesaRequest(db: DB, actor: Actor, requestId: string, fetchImpl: Fetch = fetch): Promise<MpesaStatus> {
  assertStaff(actor);
  const [request] = await db
    .select()
    .from(mpesaRequests)
    .where(and(eq(mpesaRequests.id, requestId), eq(mpesaRequests.shopId, actor.shopId)));
  if (!request) throw new DomainError('M-Pesa request not found');
  const ageSeconds = (Date.now() - request.createdAt.getTime()) / 1000;
  if (request.status !== 'pending' || !request.checkoutRequestId || ageSeconds < QUERY_AFTER_SECONDS) {
    return statusOf(request);
  }
  try {
    const { creds } = await credentials(db, actor.shopId);
    const result = await stkQuery(creds, request.checkoutRequestId, fetchImpl);
    if (result.state === 'pending') return statusOf(request);
    const done = await settle(
      db,
      request.id,
      actor.shopId,
      result.state === 'succeeded'
        ? { paid: true, receiptNumber: null, resultDesc: result.resultDesc }
        : { paid: false, resultCode: result.resultCode, resultDesc: describeResult(result.resultCode, result.resultDesc) },
    );
    return statusOf(done ?? request);
  } catch (error) {
    console.error('[mpesa] status query failed', error);
    return statusOf(request);
  }
}

// --- listing ----------------------------------------------------------------------------

export async function listMpesaRequests(db: DB, shopId: string, limit = 100) {
  const sender = alias(users, 'sender');
  return db
    .select({
      id: mpesaRequests.id,
      purpose: mpesaRequests.purpose,
      status: mpesaRequests.status,
      amountCents: mpesaRequests.amountCents,
      phone: mpesaRequests.phone,
      receiptNumber: mpesaRequests.receiptNumber,
      resultCode: mpesaRequests.resultCode,
      resultDesc: mpesaRequests.resultDesc,
      customerName: customers.name,
      productName: products.name,
      productUnit: products.unit,
      volumeMl: mpesaRequests.volumeMl,
      sentByName: sender.name,
      createdAt: mpesaRequests.createdAt,
      completedAt: mpesaRequests.completedAt,
    })
    .from(mpesaRequests)
    .leftJoin(customers, and(eq(customers.id, mpesaRequests.customerId), eq(customers.shopId, mpesaRequests.shopId)))
    .leftJoin(products, and(eq(products.id, mpesaRequests.productId), eq(products.shopId, mpesaRequests.shopId)))
    .leftJoin(sender, eq(sender.id, mpesaRequests.createdBy))
    .where(eq(mpesaRequests.shopId, shopId))
    .orderBy(desc(mpesaRequests.createdAt))
    .limit(limit);
}

export type MpesaRequestItem = Awaited<ReturnType<typeof listMpesaRequests>>[number];
