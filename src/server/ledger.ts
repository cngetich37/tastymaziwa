/**
 * Ledger write services. The only code that inserts into the ledger. Each
 * function runs in one DB transaction and writes an audit row alongside the
 * change. Callers (server actions, cron routes, scripts) handle auth.
 */
import { and, eq, lte } from 'drizzle-orm';
import type { DB, Tx } from '@/db/client';
import {
  auditLog,
  customers,
  ledgerEntries,
  subscriptions,
  suppliers,
  type LedgerEntry,
  type NewLedgerEntry,
  type Role,
} from '@/db/schema';
import { addDays, todayBusinessDate, type BusinessDate } from '@/lib/dates';
import { lineTotalCents } from '@/lib/money';
import type {
  CustomerInput,
  CustomerPaymentInput,
  DeliveryInput,
  ExpenseInput,
  SaleInput,
  SpoilageInput,
  SubscriptionInput,
  SupplierInput,
  SupplierPaymentInput,
} from '@/lib/validation';

/** Who is making the change. `null` id = the system (e.g. a scheduled job). */
export interface Actor {
  id: string | null;
  role: Role | 'system';
}

export const SYSTEM_ACTOR: Actor = { id: null, role: 'system' };

/** An expected business-rule failure, safe to show to the user. */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainError';
  }
}

const DEFAULT_CREDIT_DAYS = 7;

async function audit(
  tx: Tx,
  actor: Actor,
  action: string,
  entityType: string,
  entityId: string | null,
  data?: unknown,
) {
  await tx.insert(auditLog).values({
    userId: actor.id,
    action,
    entityType,
    entityId,
    data: data ?? null,
  });
}

async function insertEntry(tx: Tx, actor: Actor, values: NewLedgerEntry): Promise<LedgerEntry> {
  const [entry] = await tx
    .insert(ledgerEntries)
    .values({ ...values, createdBy: actor.id })
    .returning();
  await audit(tx, actor, `ledger.${values.kind}`, 'ledger_entry', entry.id, {
    amountCents: entry.amountCents,
    volumeMl: entry.volumeMl,
    paymentMethod: entry.paymentMethod,
    businessDate: entry.businessDate,
  });
  return entry;
}

async function assertCustomer(tx: Tx, customerId: string) {
  const [row] = await tx
    .select({ id: customers.id, archivedAt: customers.archivedAt })
    .from(customers)
    .where(eq(customers.id, customerId));
  if (!row) throw new DomainError('Customer not found');
  if (row.archivedAt) throw new DomainError('That customer has been archived');
}

async function assertSupplier(tx: Tx, supplierId: string) {
  const [row] = await tx
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(eq(suppliers.id, supplierId));
  if (!row) throw new DomainError('Supplier not found');
}

// --- ledger entries ---------------------------------------------------------

export function recordSale(db: DB, actor: Actor, input: SaleInput) {
  return db.transaction(async (tx) => {
    const businessDate = input.date ?? todayBusinessDate();
    if (input.customerId) await assertCustomer(tx, input.customerId);
    const isCredit = input.paymentMethod === 'credit';
    return insertEntry(tx, actor, {
      kind: 'sale',
      businessDate,
      volumeMl: input.litres,
      unitPriceCents: input.pricePerLitre,
      amountCents: lineTotalCents(input.litres, input.pricePerLitre),
      paymentMethod: input.paymentMethod,
      customerId: input.customerId ?? null,
      dueDate: isCredit ? (input.dueDate ?? addDays(businessDate, DEFAULT_CREDIT_DAYS)) : null,
      note: input.note,
    });
  });
}

export function recordDelivery(db: DB, actor: Actor, input: DeliveryInput) {
  return db.transaction(async (tx) => {
    await assertSupplier(tx, input.supplierId);
    return insertEntry(tx, actor, {
      kind: 'delivery',
      businessDate: input.date ?? todayBusinessDate(),
      volumeMl: input.litres,
      unitPriceCents: input.pricePerLitre,
      amountCents: lineTotalCents(input.litres, input.pricePerLitre),
      supplierId: input.supplierId,
      note: input.note,
    });
  });
}

export function recordCustomerPayment(db: DB, actor: Actor, input: CustomerPaymentInput) {
  return db.transaction(async (tx) => {
    await assertCustomer(tx, input.customerId);
    return insertEntry(tx, actor, {
      kind: 'customer_payment',
      businessDate: input.date ?? todayBusinessDate(),
      amountCents: input.amount,
      paymentMethod: input.paymentMethod,
      customerId: input.customerId,
      note: input.note,
    });
  });
}

export function recordSupplierPayment(db: DB, actor: Actor, input: SupplierPaymentInput) {
  return db.transaction(async (tx) => {
    await assertSupplier(tx, input.supplierId);
    return insertEntry(tx, actor, {
      kind: 'supplier_payment',
      businessDate: input.date ?? todayBusinessDate(),
      amountCents: input.amount,
      paymentMethod: input.paymentMethod,
      supplierId: input.supplierId,
      note: input.note,
    });
  });
}

export function recordExpense(db: DB, actor: Actor, input: ExpenseInput) {
  return db.transaction((tx) =>
    insertEntry(tx, actor, {
      kind: 'expense',
      businessDate: input.date ?? todayBusinessDate(),
      amountCents: input.amount,
      expenseCategory: input.category,
      note: input.note,
    }),
  );
}

export function recordSpoilage(db: DB, actor: Actor, input: SpoilageInput) {
  return db.transaction((tx) =>
    insertEntry(tx, actor, {
      kind: 'spoilage',
      businessDate: input.date ?? todayBusinessDate(),
      volumeMl: input.litres,
      expenseCategory: input.reason,
      note: input.note,
    }),
  );
}

/**
 * Cancel an entry by inserting its negation. The reversal is dated on the
 * original's business day so historical daily figures become correct.
 */
export function reverseEntry(db: DB, actor: Actor, entryId: string, reason: string) {
  return db.transaction(async (tx) => {
    const [original] = await tx.select().from(ledgerEntries).where(eq(ledgerEntries.id, entryId));
    if (!original) throw new DomainError('Entry not found');
    if (original.reversesId) throw new DomainError('A reversal cannot itself be reversed');
    const [existing] = await tx
      .select({ id: ledgerEntries.id })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.reversesId, entryId));
    if (existing) throw new DomainError('This entry has already been reversed');

    return insertEntry(tx, actor, {
      kind: original.kind,
      businessDate: original.businessDate,
      volumeMl: -original.volumeMl,
      amountCents: -original.amountCents,
      unitPriceCents: original.unitPriceCents,
      paymentMethod: original.paymentMethod,
      customerId: original.customerId,
      supplierId: original.supplierId,
      subscriptionId: original.subscriptionId,
      expenseCategory: original.expenseCategory,
      note: `Reversal: ${reason}`,
      reversesId: original.id,
    });
  });
}

// --- subscriptions ----------------------------------------------------------

/**
 * Bill every active subscription for `date` as a credit sale. Idempotent: each
 * (subscription, date) pair has a unique key, so re-running bills nothing twice.
 */
export function billSubscriptions(db: DB, actor: Actor, date: BusinessDate = todayBusinessDate()) {
  return db.transaction(async (tx) => {
    const active = await tx
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.status, 'active'), lte(subscriptions.startDate, date)));

    let billed = 0;
    let volumeMl = 0;
    let amountCents = 0;
    for (const sub of active) {
      const amount = lineTotalCents(sub.dailyMl, sub.pricePerLitreCents);
      const inserted = await tx
        .insert(ledgerEntries)
        .values({
          kind: 'sale',
          businessDate: date,
          volumeMl: sub.dailyMl,
          unitPriceCents: sub.pricePerLitreCents,
          amountCents: amount,
          paymentMethod: 'credit',
          customerId: sub.customerId,
          subscriptionId: sub.id,
          dueDate: addDays(date, DEFAULT_CREDIT_DAYS),
          note: 'Subscription delivery',
          idempotencyKey: `sub:${sub.id}:${date}`,
          createdBy: actor.id,
        })
        .onConflictDoNothing({ target: ledgerEntries.idempotencyKey })
        .returning({ id: ledgerEntries.id });
      if (inserted.length > 0) {
        billed += 1;
        volumeMl += sub.dailyMl;
        amountCents += amount;
      }
    }

    await audit(tx, actor, 'subscriptions.bill', 'subscription_run', date, {
      active: active.length,
      billed,
      volumeMl,
      amountCents,
    });
    return { date, active: active.length, billed, volumeMl, amountCents };
  });
}

export function createSubscription(db: DB, actor: Actor, input: SubscriptionInput) {
  return db.transaction(async (tx) => {
    await assertCustomer(tx, input.customerId);
    const [sub] = await tx
      .insert(subscriptions)
      .values({
        customerId: input.customerId,
        dailyMl: input.dailyLitres,
        pricePerLitreCents: input.pricePerLitre,
        startDate: input.startDate,
      })
      .returning();
    await audit(tx, actor, 'subscription.create', 'subscription', sub.id, input);
    return sub;
  });
}

export function setSubscriptionStatus(
  db: DB,
  actor: Actor,
  subscriptionId: string,
  status: 'active' | 'paused' | 'cancelled',
) {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ status: subscriptions.status })
      .from(subscriptions)
      .where(eq(subscriptions.id, subscriptionId));
    if (!current) throw new DomainError('Subscription not found');
    if (current.status === 'cancelled') {
      throw new DomainError('A cancelled subscription cannot be changed; create a new one');
    }
    const [sub] = await tx
      .update(subscriptions)
      .set({ status })
      .where(eq(subscriptions.id, subscriptionId))
      .returning();
    await audit(tx, actor, 'subscription.status', 'subscription', sub.id, {
      from: current.status,
      to: status,
    });
    return sub;
  });
}

// --- master data ------------------------------------------------------------

export function createCustomer(db: DB, actor: Actor, input: CustomerInput) {
  return db.transaction(async (tx) => {
    const [customer] = await tx
      .insert(customers)
      .values({ name: input.name, phone: input.phone ?? null, address: input.address ?? null })
      .returning();
    await audit(tx, actor, 'customer.create', 'customer', customer.id, input);
    return customer;
  });
}

export function createSupplier(db: DB, actor: Actor, input: SupplierInput) {
  return db.transaction(async (tx) => {
    const [supplier] = await tx
      .insert(suppliers)
      .values({
        name: input.name,
        phone: input.phone ?? null,
        defaultPricePerLitreCents: input.defaultPricePerLitre ?? null,
      })
      .returning();
    await audit(tx, actor, 'supplier.create', 'supplier', supplier.id, input);
    return supplier;
  });
}
