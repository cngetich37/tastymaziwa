/**
 * Till / paybill reconciliation (Daraja C2B).
 *
 * Safaricom confirms every payment made straight to the shop's till or
 * paybill to `/api/payments/c2b/<shopId>/<secret>/confirm`. Each payment is
 * reconciled once, conservatively:
 *   1. the shop's own STK prompt (same receipt)      → linked, nothing new posted
 *   2. a hand-recorded M-Pesa sale, same amount, ±15m → linked as confirmed
 *   3. a paybill account number that is a customer's phone → posted as their payment
 *   4. anything else → the owner's "match this payment" inbox (with a suggestion)
 * A hand-recorded sale entered after the payment links itself (see ledger.recordSale).
 */
import { createHash } from 'node:crypto';
import { and, asc, desc, eq, gte, inArray, isNull, lte, notLike, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { DB } from '@/db/client';
import { auditLog, customers, ledgerEntries, mpesaC2bTransactions, mpesaRequests, mpesaSettings, users } from '@/db/schema';
import {
  MATCH_WINDOW_MINUTES,
  accountMatches,
  amountToCents,
  closestSale,
  msisdnDigits,
  parseTransTime,
  payerMatches,
  readMsisdn,
  type CustomerPhone,
} from '@/lib/calc/reconcile';
import { toBusinessDate, type BusinessDate } from '@/lib/dates';
import { appUrl } from '../auth/config';
import { DomainError, postC2bCustomerPayment, type Actor } from '../ledger';
import { callbackTokenMatches, decryptSecret, hashCallbackToken, newCallbackToken } from './crypto';
import { DarajaError, parseC2bConfirmation, registerC2bUrls, simulateC2b, type DarajaCredentials } from './daraja';

type Fetch = typeof fetch;

function ownerOnly(actor: Actor) {
  if (actor.role !== 'owner') throw new DomainError('Only the owner reconciles M-Pesa payments');
}

async function settingsRow(db: DB, shopId: string) {
  const [row] = await db.select().from(mpesaSettings).where(eq(mpesaSettings.shopId, shopId));
  if (!row) throw new DomainError('Set up M-Pesa first');
  const creds: DarajaCredentials = {
    environment: row.environment,
    shortcodeType: row.shortcodeType,
    businessShortcode: row.businessShortcode,
    tillNumber: row.tillNumber,
    consumerKey: decryptSecret(row.consumerKeyEnc),
    consumerSecret: decryptSecret(row.consumerSecretEnc),
    passkey: decryptSecret(row.passkeyEnc),
  };
  return { row, creds };
}

// --- connecting the till --------------------------------------------------------------------

/**
 * Tell Safaricom where to send till/paybill payments. A fresh secret each
 * time, so re-connecting invalidates the old URLs.
 */
export async function connectTill(db: DB, actor: Actor, fetchImpl: Fetch = fetch) {
  ownerOnly(actor);
  const { creds } = await settingsRow(db, actor.shopId);
  const token = newCallbackToken();
  const base = `${appUrl()}/api/payments/c2b/${actor.shopId}/${token}`;
  try {
    await registerC2bUrls(creds, { confirmationUrl: `${base}/confirm`, validationUrl: `${base}/validate` }, fetchImpl);
  } catch (error) {
    if (error instanceof DarajaError) throw new DomainError(error.message);
    console.error('[c2b] register failed', error);
    throw new DomainError('Could not reach M-Pesa. Check the connection and try again.');
  }
  await db.transaction(async (tx) => {
    await tx
      .update(mpesaSettings)
      .set({ c2bTokenHash: hashCallbackToken(token), c2bRegisteredAt: sql`now()` })
      .where(eq(mpesaSettings.shopId, actor.shopId));
    await tx.insert(auditLog).values({
      shopId: actor.shopId,
      userId: actor.id,
      action: 'mpesa.c2b_register',
      entityType: 'shop',
      entityId: actor.shopId,
      data: { shortcode: creds.businessShortcode },
    });
  });
}

/** Sandbox only: a pretend customer payment, to see reconciliation work end to end. */
export async function simulateTillPayment(
  db: DB,
  actor: Actor,
  input: { amount: number; phone: string },
  fetchImpl: Fetch = fetch,
) {
  ownerOnly(actor);
  const { creds } = await settingsRow(db, actor.shopId);
  if (input.amount % 100 !== 0) throw new DomainError('Use a whole-shilling amount');
  try {
    await simulateC2b(creds, { amountShillings: input.amount / 100, phone: input.phone, billRef: msisdnDigits(input.phone) }, fetchImpl);
  } catch (error) {
    if (error instanceof DarajaError) throw new DomainError(error.message);
    throw error;
  }
}

// --- confirmations --------------------------------------------------------------------------

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

async function customerPhones(db: DB, shopId: string): Promise<CustomerPhone[]> {
  const rows = await db
    .select({ id: customers.id, phone: customers.phone })
    .from(customers)
    .where(and(eq(customers.shopId, shopId), isNull(customers.archivedAt), sql`${customers.phone} is not null`));
  return rows.map((r) => ({ id: r.id, phone: r.phone!, phoneHash: sha256(msisdnDigits(r.phone!)) }));
}

/** Hand-recorded M-Pesa sales near `at` not yet confirmed by a till payment. */
async function unconfirmedSalesNear(db: DB | Parameters<Parameters<DB['transaction']>[0]>[0], shopId: string, at: Date) {
  const linked = alias(mpesaC2bTransactions, 'linked');
  const reversal = alias(ledgerEntries, 'reversal');
  return db
    .select({ id: ledgerEntries.id, amountCents: ledgerEntries.amountCents, at: ledgerEntries.occurredAt })
    .from(ledgerEntries)
    .leftJoin(linked, eq(linked.ledgerEntryId, ledgerEntries.id))
    .leftJoin(reversal, eq(reversal.reversesId, ledgerEntries.id))
    .where(
      and(
        eq(ledgerEntries.shopId, shopId),
        eq(ledgerEntries.kind, 'sale'),
        eq(ledgerEntries.paymentMethod, 'mpesa'),
        isNull(ledgerEntries.reversesId),
        isNull(reversal.id),
        isNull(linked.id),
        // STK prompt sales are confirmed by their own receipt.
        or(isNull(ledgerEntries.idempotencyKey), notLike(ledgerEntries.idempotencyKey, 'mpesa:%')),
        gte(ledgerEntries.occurredAt, new Date(at.getTime() - MATCH_WINDOW_MINUTES * 60_000)),
        lte(ledgerEntries.occurredAt, new Date(at.getTime() + MATCH_WINDOW_MINUTES * 60_000)),
      ),
    );
}

export type C2bOutcome = 'stk' | 'matched_sale' | 'posted_payment' | 'unmatched' | 'duplicate' | 'ignored';

/**
 * Safaricom's confirmation. The URL's per-shop secret must match and the
 * shortcode must be the shop's; a payment is stored and reconciled once.
 */
export async function handleC2bConfirmation(db: DB, shopId: string, token: string, body: unknown): Promise<C2bOutcome> {
  const c = parseC2bConfirmation(body);
  if (!c) return 'ignored';
  const [settings] = await db.select().from(mpesaSettings).where(eq(mpesaSettings.shopId, shopId));
  if (!settings?.c2bTokenHash || !callbackTokenMatches(token, settings.c2bTokenHash)) return 'ignored';
  if (c.businessShortcode !== settings.businessShortcode && c.businessShortcode !== settings.tillNumber) return 'ignored';
  const amountCents = amountToCents(c.amount);
  if (amountCents == null) return 'ignored';
  const transTime = parseTransTime(c.transTime);
  const orgBalance = amountToCents(c.orgBalance);
  const phones = await customerPhones(db, shopId);

  return db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: mpesaC2bTransactions.id }).from(mpesaC2bTransactions).where(eq(mpesaC2bTransactions.transId, c.transId));
    if (existing) return 'duplicate';

    const base = {
      shopId,
      transId: c.transId,
      transType: c.transType,
      transTime,
      businessDate: toBusinessDate(transTime),
      amountCents,
      businessShortcode: c.businessShortcode,
      billRef: c.billRef,
      msisdn: c.msisdn,
      payerName: c.payerName,
      orgBalanceCents: orgBalance,
      matchedAt: sql`now()`,
    };

    // 1. Our own STK prompt.
    const [stk] = await tx
      .select({ ledgerEntryId: mpesaRequests.ledgerEntryId, customerId: mpesaRequests.customerId })
      .from(mpesaRequests)
      .where(and(eq(mpesaRequests.shopId, shopId), eq(mpesaRequests.receiptNumber, c.transId)));
    if (stk?.ledgerEntryId) {
      await tx.insert(mpesaC2bTransactions).values({ ...base, status: 'stk', ledgerEntryId: stk.ledgerEntryId, customerId: stk.customerId });
      return 'stk';
    }

    // 2. A sale a seller recorded as M-Pesa.
    const sale = closestSale(amountCents, transTime, await unconfirmedSalesNear(tx, shopId, transTime));
    if (sale) {
      await tx.insert(mpesaC2bTransactions).values({ ...base, status: 'matched_sale', ledgerEntryId: sale.id });
      return 'matched_sale';
    }

    // 3. A paybill payment to an account number that is exactly one customer's phone.
    const byAccount = accountMatches(c.billRef, phones);
    if (byAccount.length === 1) {
      const [row] = await tx
        .insert(mpesaC2bTransactions)
        .values({ ...base, status: 'unmatched', customerId: byAccount[0], matchedAt: null })
        .returning();
      const entry = await postC2bCustomerPayment(tx, row, byAccount[0], null);
      await tx
        .update(mpesaC2bTransactions)
        .set({ status: 'posted_payment', ledgerEntryId: entry.id, matchedAt: sql`now()` })
        .where(eq(mpesaC2bTransactions.id, row.id));
      return 'posted_payment';
    }

    // 4. The owner decides; suggest the payer if their number points to one customer.
    const byPhone = payerMatches(readMsisdn(c.msisdn), phones);
    await tx.insert(mpesaC2bTransactions).values({
      ...base,
      status: 'unmatched',
      customerId: byPhone.length === 1 ? byPhone[0] : null,
      matchedAt: null,
    });
    return 'unmatched';
  });
}

/** Validation: accept everything (the shop never refuses money). */
export const C2B_ACCEPT = { ResultCode: '0', ResultDesc: 'Accepted' } as const;

// --- the owner's inbox ---------------------------------------------------------------------

async function lockUnmatched(tx: Parameters<Parameters<DB['transaction']>[0]>[0], actor: Actor, id: string) {
  const [row] = await tx
    .select()
    .from(mpesaC2bTransactions)
    .where(and(eq(mpesaC2bTransactions.id, id), eq(mpesaC2bTransactions.shopId, actor.shopId)))
    .for('update');
  if (!row) throw new DomainError('Payment not found');
  if (row.status !== 'unmatched') throw new DomainError('This payment has already been matched');
  return row;
}

async function audit(tx: Parameters<Parameters<DB['transaction']>[0]>[0], actor: Actor, action: string, id: string, data: unknown) {
  await tx.insert(auditLog).values({ shopId: actor.shopId, userId: actor.id, action, entityType: 'mpesa_c2b', entityId: id, data });
}

/** "This was Jane paying her deni": post it as her payment. */
export async function matchToCustomer(db: DB, actor: Actor, input: { c2bId: string; customerId: string }) {
  ownerOnly(actor);
  return db.transaction(async (tx) => {
    const row = await lockUnmatched(tx, actor, input.c2bId);
    const entry = await postC2bCustomerPayment(tx, row, input.customerId, actor.id);
    await tx
      .update(mpesaC2bTransactions)
      .set({ status: 'posted_payment', customerId: input.customerId, ledgerEntryId: entry.id, matchedBy: actor.id, matchedAt: sql`now()` })
      .where(eq(mpesaC2bTransactions.id, row.id));
    await audit(tx, actor, 'mpesa.c2b_match_customer', row.id, { customerId: input.customerId, entryId: entry.id });
  });
}

/** "This paid for that sale": link it to a recorded M-Pesa sale of the same amount. */
export async function matchToSale(db: DB, actor: Actor, input: { c2bId: string; entryId: string }) {
  ownerOnly(actor);
  return db.transaction(async (tx) => {
    const row = await lockUnmatched(tx, actor, input.c2bId);
    const [sale] = await tx
      .select()
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.id, input.entryId), eq(ledgerEntries.shopId, actor.shopId)));
    if (!sale || sale.kind !== 'sale' || sale.paymentMethod !== 'mpesa' || sale.reversesId) {
      throw new DomainError('Choose an M-Pesa sale');
    }
    if (sale.amountCents !== row.amountCents) throw new DomainError('That sale is for a different amount');
    const [taken] = await tx
      .select({ id: mpesaC2bTransactions.id })
      .from(mpesaC2bTransactions)
      .where(eq(mpesaC2bTransactions.ledgerEntryId, sale.id));
    if (taken) throw new DomainError('That sale is already matched to another payment');
    await tx
      .update(mpesaC2bTransactions)
      .set({ status: 'matched_sale', ledgerEntryId: sale.id, matchedBy: actor.id, matchedAt: sql`now()` })
      .where(eq(mpesaC2bTransactions.id, row.id));
    await audit(tx, actor, 'mpesa.c2b_match_sale', row.id, { entryId: sale.id });
  });
}

/** "Not shop business" (e.g. a personal transfer), with the reason. */
export async function ignoreC2b(db: DB, actor: Actor, input: { c2bId: string; note: string }) {
  ownerOnly(actor);
  return db.transaction(async (tx) => {
    const row = await lockUnmatched(tx, actor, input.c2bId);
    await tx
      .update(mpesaC2bTransactions)
      .set({ status: 'ignored', note: input.note, matchedBy: actor.id, matchedAt: sql`now()` })
      .where(eq(mpesaC2bTransactions.id, row.id));
    await audit(tx, actor, 'mpesa.c2b_ignore', row.id, { note: input.note });
  });
}

// --- reconciliation view ----------------------------------------------------------------------

export async function getTillReconciliation(db: DB, shopId: string, date: BusinessDate) {
  const suggested = alias(customers, 'suggested');
  const matcher = alias(users, 'matcher');
  const linked = alias(mpesaC2bTransactions, 'linked');
  const reversal = alias(ledgerEntries, 'reversal');
  const [received, recorded, inbox, settings] = await Promise.all([
    db
      .select({
        id: mpesaC2bTransactions.id,
        transId: mpesaC2bTransactions.transId,
        transTime: mpesaC2bTransactions.transTime,
        amountCents: mpesaC2bTransactions.amountCents,
        payerName: mpesaC2bTransactions.payerName,
        billRef: mpesaC2bTransactions.billRef,
        status: mpesaC2bTransactions.status,
        note: mpesaC2bTransactions.note,
        customerName: suggested.name,
        matchedByName: matcher.name,
      })
      .from(mpesaC2bTransactions)
      .leftJoin(suggested, and(eq(suggested.id, mpesaC2bTransactions.customerId), eq(suggested.shopId, mpesaC2bTransactions.shopId)))
      .leftJoin(matcher, eq(matcher.id, mpesaC2bTransactions.matchedBy))
      .where(and(eq(mpesaC2bTransactions.shopId, shopId), eq(mpesaC2bTransactions.businessDate, date)))
      .orderBy(asc(mpesaC2bTransactions.transTime)),
    // Everything the books show as M-Pesa that day, and whether a till payment confirms it.
    db
      .select({
        id: ledgerEntries.id,
        kind: ledgerEntries.kind,
        amountCents: ledgerEntries.amountCents,
        occurredAt: ledgerEntries.occurredAt,
        createdByName: users.name,
        viaPrompt: sql<boolean>`coalesce(${ledgerEntries.idempotencyKey} like 'mpesa:%', false)`,
        confirmedBy: linked.transId,
      })
      .from(ledgerEntries)
      .leftJoin(users, eq(users.id, ledgerEntries.createdBy))
      .leftJoin(linked, eq(linked.ledgerEntryId, ledgerEntries.id))
      .leftJoin(reversal, eq(reversal.reversesId, ledgerEntries.id))
      .where(
        and(
          eq(ledgerEntries.shopId, shopId),
          eq(ledgerEntries.businessDate, date),
          eq(ledgerEntries.paymentMethod, 'mpesa'),
          inArray(ledgerEntries.kind, ['sale', 'customer_payment']),
          isNull(ledgerEntries.reversesId),
          isNull(reversal.id),
        ),
      )
      .orderBy(asc(ledgerEntries.occurredAt)),
    // The inbox spans all days: nothing waits unseen.
    db
      .select({
        id: mpesaC2bTransactions.id,
        transId: mpesaC2bTransactions.transId,
        transTime: mpesaC2bTransactions.transTime,
        amountCents: mpesaC2bTransactions.amountCents,
        payerName: mpesaC2bTransactions.payerName,
        billRef: mpesaC2bTransactions.billRef,
        customerId: mpesaC2bTransactions.customerId,
        customerName: suggested.name,
      })
      .from(mpesaC2bTransactions)
      .leftJoin(suggested, and(eq(suggested.id, mpesaC2bTransactions.customerId), eq(suggested.shopId, mpesaC2bTransactions.shopId)))
      .where(and(eq(mpesaC2bTransactions.shopId, shopId), eq(mpesaC2bTransactions.status, 'unmatched')))
      .orderBy(desc(mpesaC2bTransactions.transTime)),
    db
      .select({ registeredAt: mpesaSettings.c2bRegisteredAt, environment: mpesaSettings.environment })
      .from(mpesaSettings)
      .where(eq(mpesaSettings.shopId, shopId)),
  ]);

  // Sales of the same amount still waiting for money: what an inbox payment might match.
  const openSales = recorded.filter((r) => r.kind === 'sale' && !r.viaPrompt && !r.confirmedBy);
  const receivedCents = received.filter((r) => r.status !== 'ignored').reduce((n, r) => n + r.amountCents, 0);
  const recordedCents = recorded.reduce((n, r) => n + r.amountCents, 0);
  const staleBefore = Date.now() - MATCH_WINDOW_MINUTES * 60_000;
  return {
    connected: settings[0]?.registeredAt ?? null,
    environment: settings[0]?.environment ?? null,
    received,
    recorded,
    inbox,
    openSales,
    totals: {
      receivedCents,
      recordedCents,
      differenceCents: receivedCents - recordedCents,
      /** Hand-recorded M-Pesa sales with no money seen after the matching window. */
      unconfirmed: openSales.filter((s) => s.occurredAt.getTime() < staleBefore),
    },
  };
}

/** Open M-Pesa sales of a given amount (any day), for matching one inbox payment. */
export async function salesForAmount(db: DB, shopId: string, amountCents: number) {
  const linked = alias(mpesaC2bTransactions, 'linked');
  const reversal = alias(ledgerEntries, 'reversal');
  return db
    .select({ id: ledgerEntries.id, occurredAt: ledgerEntries.occurredAt, createdByName: users.name })
    .from(ledgerEntries)
    .leftJoin(users, eq(users.id, ledgerEntries.createdBy))
    .leftJoin(linked, eq(linked.ledgerEntryId, ledgerEntries.id))
    .leftJoin(reversal, eq(reversal.reversesId, ledgerEntries.id))
    .where(
      and(
        eq(ledgerEntries.shopId, shopId),
        eq(ledgerEntries.kind, 'sale'),
        eq(ledgerEntries.paymentMethod, 'mpesa'),
        eq(ledgerEntries.amountCents, amountCents),
        isNull(ledgerEntries.reversesId),
        isNull(reversal.id),
        isNull(linked.id),
        or(isNull(ledgerEntries.idempotencyKey), notLike(ledgerEntries.idempotencyKey, 'mpesa:%')),
      ),
    )
    .orderBy(desc(ledgerEntries.occurredAt))
    .limit(20);
}

/** For the owner's "needs your attention" list. */
export async function countUnmatchedC2b(db: DB, shopId: string): Promise<{ count: number; cents: number }> {
  const [row] = await db
    .select({
      count: sql<number>`count(*)`.mapWith(Number),
      cents: sql<number>`coalesce(sum(${mpesaC2bTransactions.amountCents}), 0)`.mapWith(Number),
    })
    .from(mpesaC2bTransactions)
    .where(and(eq(mpesaC2bTransactions.shopId, shopId), eq(mpesaC2bTransactions.status, 'unmatched')));
  return row ?? { count: 0, cents: 0 };
}
