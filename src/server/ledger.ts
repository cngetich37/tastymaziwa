/**
 * Ledger write services. The only code that inserts into the ledger. Each
 * function runs in one DB transaction and writes an audit row alongside the
 * change. Callers (server actions, cron routes, scripts) handle auth.
 */
import { and, desc, eq, gt, gte, isNull, lte, sql } from 'drizzle-orm';
import type { DB, Tx } from '@/db/client';
import {
  attendance,
  auditLog,
  employeeAdvances,
  employees,
  payrollLines,
  payrollRuns,
  customers,
  deliverySubmissions,
  expenseBudgets,
  ledgerEntries,
  mpesaC2bTransactions,
  products,
  shiftCloses,
  shops,
  subscriptions,
  suppliers,
  users,
  type LedgerEntry,
  type NewLedgerEntry,
  type C2bTransaction,
  type MpesaRequest,
  type PayType,
  type Role,
} from '@/db/schema';
import { addDays, todayBusinessDate, type BusinessDate } from '@/lib/dates';
import { expectedTakings } from '@/lib/calc/close';
import { overCreditLimit } from '@/lib/calc/finance';
import { computePay, type PayLine } from '@/lib/calc/payroll';
import { MATCH_WINDOW_MINUTES, closestSale } from '@/lib/calc/reconcile';
import { formatKES, lineTotalCents } from '@/lib/money';
import { demoOff, isDemoShop } from './demo/guard';
import type {
  CustomerInput,
  AdvanceInput,
  AttendanceInput,
  BudgetsInput,
  EmployeeInput,
  PostPayrollInput,
  RemitStatutoryInput,
  UpdateEmployeeInput,
  CustomerPaymentInput,
  PaySuppliersInput,
  ProductInput,
  ReviewShiftCloseInput,
  ShiftCloseInput,
  UpdateProductInput,
  DeliveryInput,
  ExpenseInput,
  ReviewDeliveryInput,
  SaleInput,
  SpoilageInput,
  SubmitDeliveryInput,
  SubscriptionInput,
  SupplierInput,
  SupplierPaymentInput,
  UpdateCustomerInput,
  UpdateSupplierInput,
} from '@/lib/validation';

/**
 * Who is making the change, and in which shop. Every service is scoped to
 * `actor.shopId`. `null` id = the system (e.g. the billing cron).
 */
export interface Actor {
  id: string | null;
  role: Role | 'system';
  shopId: string;
}

export const systemActor = (shopId: string): Actor => ({ id: null, role: 'system', shopId });

/** An expected business-rule failure, safe to show to the user. */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainError';
  }
}

const DEFAULT_CREDIT_DAYS = 7;

/**
 * Owners (and the system) set prices and may date entries on another day.
 * Attendants record quantities at the owner's prices, for today only: the
 * same rules a till applies to cashiers ("manager override").
 */
const isManager = (actor: Actor) => actor.role === 'owner' || actor.role === 'system';

/** Suppliers only ever submit deliveries for the shop to approve; never ledger entries. */
function assertShopActor(actor: Actor) {
  if (actor.role === 'supplier') throw new DomainError('You do not have permission to do that.');
}

/** Every ledger entry service starts here, so it also refuses supplier logins up front. */
function entryDateFor(actor: Actor, date: BusinessDate | undefined): BusinessDate {
  assertShopActor(actor);
  const today = todayBusinessDate();
  if (date && date !== today && !isManager(actor)) {
    throw new DomainError('Only the owner can record entries for another day');
  }
  return date ?? today;
}

async function audit(
  tx: Tx,
  actor: Actor,
  action: string,
  entityType: string,
  entityId: string | null,
  data?: unknown,
) {
  await tx.insert(auditLog).values({
    shopId: actor.shopId,
    userId: actor.id,
    action,
    entityType,
    entityId,
    data: data ?? null,
  });
}

async function insertEntry(tx: Tx, actor: Actor, values: Omit<NewLedgerEntry, 'shopId'>): Promise<LedgerEntry> {
  assertShopActor(actor);
  const [entry] = await tx
    .insert(ledgerEntries)
    .values({ ...values, shopId: actor.shopId, createdBy: actor.id })
    .returning();
  await audit(tx, actor, `ledger.${values.kind}`, 'ledger_entry', entry.id, {
    amountCents: entry.amountCents,
    volumeMl: entry.volumeMl,
    paymentMethod: entry.paymentMethod,
    businessDate: entry.businessDate,
  });
  return entry;
}

export async function assertCustomer(tx: Tx, actor: Actor, customerId: string) {
  const [row] = await tx
    .select({
      id: customers.id,
      name: customers.name,
      creditLimitCents: customers.creditLimitCents,
      archivedAt: customers.archivedAt,
    })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.shopId, actor.shopId)));
  if (!row) throw new DomainError('Customer not found');
  if (row.archivedAt) throw new DomainError('That customer has been archived');
  return row;
}

/** What a customer owes now: credit sales minus payments (reversals net out). */
async function customerBalance(tx: Tx, actor: Actor, customerId: string): Promise<number> {
  const [row] = await tx
    .select({
      cents: sql<number>`coalesce(sum(case
        when ${ledgerEntries.kind} = 'sale' and ${ledgerEntries.paymentMethod} = 'credit' then ${ledgerEntries.amountCents}
        when ${ledgerEntries.kind} = 'customer_payment' then -${ledgerEntries.amountCents}
        else 0 end), 0)`.mapWith(Number),
    })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.shopId, actor.shopId), eq(ledgerEntries.customerId, customerId)));
  return row?.cents ?? 0;
}

async function assertSupplier(tx: Tx, actor: Actor, supplierId: string) {
  const [row] = await tx
    .select({ id: suppliers.id, name: suppliers.name, price: suppliers.defaultPricePerLitreCents, archivedAt: suppliers.archivedAt })
    .from(suppliers)
    .where(and(eq(suppliers.id, supplierId), eq(suppliers.shopId, actor.shopId)));
  if (!row) throw new DomainError('Supplier not found');
  if (row.archivedAt) throw new DomainError('That supplier has been archived');
  return row;
}

async function shopSalePrice(tx: Tx, actor: Actor): Promise<number | null> {
  const [row] = await tx
    .select({ price: shops.salePricePerLitreCents })
    .from(shops)
    .where(eq(shops.id, actor.shopId));
  return row?.price ?? null;
}

async function assertProduct(tx: Tx, actor: Actor, productId: string) {
  const [row] = await tx
    .select()
    .from(products)
    .where(and(eq(products.id, productId), eq(products.shopId, actor.shopId)));
  if (!row) throw new DomainError('Product not found');
  if (row.archivedAt) throw new DomainError(`${row.name} is no longer sold`);
  return row;
}

/**
 * The price an entry is recorded at. A manager may type a different price
 * for one entry; anyone else always gets the price on file.
 */
function resolvePrice(
  actor: Actor,
  requested: number | undefined,
  onFile: number | null,
  missing: { manager: string; staff: string },
): number {
  if (requested != null && requested !== onFile) {
    if (!isManager(actor)) throw new DomainError('Only the owner can change prices');
    return requested;
  }
  if (onFile == null) throw new DomainError(isManager(actor) ? missing.manager : missing.staff);
  return onFile;
}

// --- ledger entries ---------------------------------------------------------

/**
 * The price and total of a sale, by the same rules for every way of selling
 * (counter, M-Pesa prompt): the owner's price, which only the owner may change.
 */
export async function quoteSale(
  tx: Tx,
  actor: Actor,
  input: { litres: number; productId?: string; pricePerLitre?: number },
) {
  const product = input.productId ? await assertProduct(tx, actor, input.productId) : null;
  const price = product
    ? resolvePrice(actor, input.pricePerLitre, product.salePriceCents, {
        manager: `Set ${product.name}'s selling price first, or type a price`,
        staff: `The owner has not set ${product.name}'s price yet`,
      })
    : resolvePrice(actor, input.pricePerLitre, await shopSalePrice(tx, actor), {
        manager: 'Set your selling price in Settings first, or type a price',
        staff: 'The owner has not set a selling price yet',
      });
  return { product, price, amountCents: lineTotalCents(input.litres, price) };
}

export function recordSale(db: DB, actor: Actor, input: SaleInput) {
  return db.transaction(async (tx) => {
    const businessDate = entryDateFor(actor, input.date);
    const customer = input.customerId ? await assertCustomer(tx, actor, input.customerId) : null;
    const { product, price, amountCents } = await quoteSale(tx, actor, input);
    const isCredit = input.paymentMethod === 'credit';
    if (isCredit && customer && !isManager(actor)) {
      const balance = await customerBalance(tx, actor, customer.id);
      if (overCreditLimit(balance, amountCents, customer.creditLimitCents)) {
        throw new DomainError(
          `${customer.name} would owe ${formatKES(balance + amountCents)}, over their limit of ${formatKES(customer.creditLimitCents!)}. Ask the owner.`,
        );
      }
    }
    const entry = await insertEntry(tx, actor, {
      kind: 'sale',
      businessDate,
      productId: product?.id ?? null,
      volumeMl: input.litres,
      unitPriceCents: price,
      amountCents,
      paymentMethod: input.paymentMethod,
      customerId: input.customerId ?? null,
      dueDate: isCredit ? (input.dueDate ?? addDays(businessDate, DEFAULT_CREDIT_DAYS)) : null,
      note: input.note,
    });
    if (entry.paymentMethod === 'mpesa') await linkIncomingMpesa(tx, actor, entry);
    return entry;
  });
}

/**
 * A seller recorded an M-Pesa sale after the customer paid the till: link it
 * to that waiting payment (same amount, within the window, closest in time).
 */
async function linkIncomingMpesa(tx: Tx, actor: Actor, entry: LedgerEntry) {
  const waiting = await tx
    .select({ id: mpesaC2bTransactions.id, amountCents: mpesaC2bTransactions.amountCents, at: mpesaC2bTransactions.transTime })
    .from(mpesaC2bTransactions)
    .where(
      and(
        eq(mpesaC2bTransactions.shopId, actor.shopId),
        eq(mpesaC2bTransactions.status, 'unmatched'),
        eq(mpesaC2bTransactions.amountCents, entry.amountCents),
        gte(mpesaC2bTransactions.transTime, sql`${entry.occurredAt}::timestamptz - make_interval(mins => ${MATCH_WINDOW_MINUTES})`),
        lte(mpesaC2bTransactions.transTime, sql`${entry.occurredAt}::timestamptz + make_interval(mins => ${MATCH_WINDOW_MINUTES})`),
      ),
    );
  const match = closestSale(entry.amountCents, entry.occurredAt, waiting);
  if (!match) return;
  await tx
    .update(mpesaC2bTransactions)
    .set({ status: 'matched_sale', ledgerEntryId: entry.id, matchedBy: actor.id, matchedAt: sql`now()` })
    .where(and(eq(mpesaC2bTransactions.id, match.id), eq(mpesaC2bTransactions.status, 'unmatched')));
}

/** Whether a supplier has an active login of their own (and so records their own deliveries). */
async function supplierHasLogin(tx: Tx, actor: Actor, supplierId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.supplierId, supplierId), eq(users.shopId, actor.shopId), eq(users.active, true)));
  return row != null;
}

function deliveryPrice(actor: Actor, requested: number | undefined, supplier: { name: string; price: number | null }) {
  return resolvePrice(actor, requested, supplier.price, {
    manager: `Set ${supplier.name}'s price per litre first, or type a price`,
    staff: `The owner has not set ${supplier.name}'s price per litre yet`,
  });
}

/**
 * Milk received, typed in by the shop. A supplier with their own login
 * records their deliveries themselves and the seller approves them
 * (submitDelivery / reviewDelivery), so attendants can't also type one in.
 * The owner still can (e.g. the milkman's phone is broken); it is audited.
 */
export function recordDelivery(db: DB, actor: Actor, input: DeliveryInput) {
  return db.transaction(async (tx) => {
    if (actor.role === 'supplier') throw new DomainError('Record your delivery from your own page');
    const businessDate = entryDateFor(actor, input.date);
    const supplier = await assertSupplier(tx, actor, input.supplierId);
    if (input.productId) {
      // Buying stock other than milk is the owner's job, at the price they type or the usual cost.
      if (!isManager(actor)) throw new DomainError('Only the owner can record stock purchases');
      const product = await assertProduct(tx, actor, input.productId);
      const price = input.pricePerLitre ?? product.costPriceCents;
      if (price == null) throw new DomainError(`Type a buying price for ${product.name}`);
      return insertEntry(tx, actor, {
        kind: 'delivery',
        businessDate,
        productId: product.id,
        volumeMl: input.litres,
        unitPriceCents: price,
        amountCents: lineTotalCents(input.litres, price),
        supplierId: input.supplierId,
        note: input.note,
      });
    }
    if (!isManager(actor) && (await supplierHasLogin(tx, actor, input.supplierId))) {
      throw new DomainError(
        `${supplier.name} records their own deliveries. Approve it under "Waiting for approval" instead.`,
      );
    }
    const price = deliveryPrice(actor, input.pricePerLitre, supplier);
    return insertEntry(tx, actor, {
      kind: 'delivery',
      businessDate,
      volumeMl: input.litres,
      unitPriceCents: price,
      amountCents: lineTotalCents(input.litres, price),
      supplierId: input.supplierId,
      note: input.note,
    });
  });
}

// --- supplier-recorded deliveries ---------------------------------------------

/**
 * A supplier records the litres they just delivered. Nothing reaches the
 * ledger (or stock) until the seller approves it. Always dated today, and
 * always for the supplier this login belongs to: never taken from input.
 */
export function submitDelivery(db: DB, actor: Actor, input: SubmitDeliveryInput) {
  return db.transaction(async (tx) => {
    if (actor.role !== 'supplier' || !actor.id) throw new DomainError('Only suppliers record deliveries here');
    const [me] = await tx
      .select({ supplierId: users.supplierId })
      .from(users)
      .where(and(eq(users.id, actor.id), eq(users.shopId, actor.shopId), eq(users.active, true)));
    if (!me?.supplierId) throw new DomainError('Your login is not linked to a supplier');
    await assertSupplier(tx, actor, me.supplierId);
    const [submission] = await tx
      .insert(deliverySubmissions)
      .values({
        shopId: actor.shopId,
        supplierId: me.supplierId,
        businessDate: todayBusinessDate(),
        volumeMl: input.litres,
        note: input.note ?? null,
        submittedBy: actor.id,
      })
      .returning();
    await audit(tx, actor, 'delivery.submit', 'delivery_submission', submission.id, {
      supplierId: submission.supplierId,
      volumeMl: submission.volumeMl,
      businessDate: submission.businessDate,
    });
    return submission;
  });
}

/**
 * The seller checks a supplier's delivery against what arrived. Approving
 * posts it to the ledger at the supplier's agreed price, on the day and time
 * it was delivered; rejecting sends it back with a reason, and the supplier
 * records it again. Each delivery is decided once, by someone other than
 * the person who recorded it.
 */
export function reviewDelivery(db: DB, actor: Actor, input: ReviewDeliveryInput) {
  return db.transaction(async (tx) => {
    if (actor.role !== 'owner' && actor.role !== 'attendant') {
      throw new DomainError('Only the shop can approve deliveries');
    }
    const [submission] = await tx
      .select()
      .from(deliverySubmissions)
      .where(and(eq(deliverySubmissions.id, input.submissionId), eq(deliverySubmissions.shopId, actor.shopId)))
      // Two sellers tapping at once: the second waits, then sees it is decided.
      .for('update');
    if (!submission) throw new DomainError('Delivery not found');
    if (submission.status !== 'pending') throw new DomainError(`This delivery was already ${submission.status}`);
    if (submission.submittedBy === actor.id) throw new DomainError("You can't approve a delivery you recorded");

    let ledgerEntryId: string | null = null;
    if (input.decision === 'approve') {
      const supplier = await assertSupplier(tx, actor, submission.supplierId);
      const price = deliveryPrice(actor, undefined, supplier);
      const entry = await insertEntry(tx, actor, {
        kind: 'delivery',
        businessDate: submission.businessDate,
        occurredAt: submission.submittedAt,
        volumeMl: submission.volumeMl,
        unitPriceCents: price,
        amountCents: lineTotalCents(submission.volumeMl, price),
        supplierId: submission.supplierId,
        note: submission.note,
        idempotencyKey: `delivery-sub:${submission.id}`,
      });
      ledgerEntryId = entry.id;
    }

    const [reviewed] = await tx
      .update(deliverySubmissions)
      .set({
        status: input.decision === 'approve' ? 'approved' : 'rejected',
        reviewedBy: actor.id,
        reviewedAt: sql`now()`,
        reviewNote: input.reason ?? null,
        ledgerEntryId,
      })
      .where(and(eq(deliverySubmissions.id, submission.id), eq(deliverySubmissions.shopId, actor.shopId)))
      .returning();
    await audit(tx, actor, `delivery.${reviewed.status === 'approved' ? 'approve' : 'reject'}`, 'delivery_submission', reviewed.id, {
      volumeMl: reviewed.volumeMl,
      supplierId: reviewed.supplierId,
      reason: reviewed.reviewNote,
      ledgerEntryId,
    });
    return reviewed;
  });
}

export function recordCustomerPayment(db: DB, actor: Actor, input: CustomerPaymentInput) {
  return db.transaction(async (tx) => {
    await assertCustomer(tx, actor, input.customerId);
    return insertEntry(tx, actor, {
      kind: 'customer_payment',
      businessDate: entryDateFor(actor, input.date),
      amountCents: input.amount,
      paymentMethod: input.paymentMethod,
      customerId: input.customerId,
      note: input.note,
    });
  });
}

export function recordSupplierPayment(db: DB, actor: Actor, input: SupplierPaymentInput) {
  return db.transaction(async (tx) => {
    await assertSupplier(tx, actor, input.supplierId);
    return insertEntry(tx, actor, {
      kind: 'supplier_payment',
      businessDate: entryDateFor(actor, input.date),
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
      businessDate: entryDateFor(actor, input.date),
      amountCents: input.amount,
      paymentMethod: input.paymentMethod ?? 'cash',
      expenseCategory: input.category,
      note: input.note,
    }),
  );
}

export function recordSpoilage(db: DB, actor: Actor, input: SpoilageInput) {
  return db.transaction(async (tx) => {
    const businessDate = entryDateFor(actor, input.date);
    const product = input.productId ? await assertProduct(tx, actor, input.productId) : null;
    return insertEntry(tx, actor, {
      kind: 'spoilage',
      businessDate,
      productId: product?.id ?? null,
      volumeMl: input.litres,
      expenseCategory: input.reason,
      note: input.note,
    });
  });
}

/**
 * Cancel an entry by inserting its negation. The reversal is dated on the
 * original's business day so historical daily figures become correct.
 */
export function reverseEntry(db: DB, actor: Actor, entryId: string, reason: string) {
  return db.transaction(async (tx) => {
    const [original] = await tx
      .select()
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.id, entryId), eq(ledgerEntries.shopId, actor.shopId)));
    if (!original) throw new DomainError('Entry not found');
    if (original.reversesId) throw new DomainError('A reversal cannot itself be reversed');
    const [existing] = await tx
      .select({ id: ledgerEntries.id })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.reversesId, entryId));
    if (existing) throw new DomainError('This entry has already been reversed');
    // Money that really arrived on the till goes back to the inbox to be matched again.
    await tx
      .update(mpesaC2bTransactions)
      .set({ status: 'unmatched', ledgerEntryId: null, matchedBy: null, matchedAt: null })
      .where(and(eq(mpesaC2bTransactions.shopId, actor.shopId), eq(mpesaC2bTransactions.ledgerEntryId, original.id)));

    return insertEntry(tx, actor, {
      kind: original.kind,
      businessDate: original.businessDate,
      volumeMl: -original.volumeMl,
      amountCents: -original.amountCents,
      unitPriceCents: original.unitPriceCents,
      paymentMethod: original.paymentMethod,
      productId: original.productId,
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
      .where(
        and(
          eq(subscriptions.shopId, actor.shopId),
          eq(subscriptions.status, 'active'),
          lte(subscriptions.startDate, date),
        ),
      );

    let billed = 0;
    let volumeMl = 0;
    let amountCents = 0;
    for (const sub of active) {
      const amount = lineTotalCents(sub.dailyMl, sub.pricePerLitreCents);
      const inserted = await tx
        .insert(ledgerEntries)
        .values({
          shopId: actor.shopId,
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
    await assertCustomer(tx, actor, input.customerId);
    const [sub] = await tx
      .insert(subscriptions)
      .values({
        shopId: actor.shopId,
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
      .where(and(eq(subscriptions.id, subscriptionId), eq(subscriptions.shopId, actor.shopId)));
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
      .values({
        shopId: actor.shopId,
        name: input.name,
        phone: input.phone ?? null,
        address: input.address ?? null,
        creditLimitCents: input.creditLimit ?? null,
      })
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
        shopId: actor.shopId,
        name: input.name,
        phone: input.phone ?? null,
        defaultPricePerLitreCents: input.defaultPricePerLitre ?? null,
      })
      .returning();
    await audit(tx, actor, 'supplier.create', 'supplier', supplier.id, input);
    return supplier;
  });
}

export function updateCustomer(db: DB, actor: Actor, input: UpdateCustomerInput) {
  return db.transaction(async (tx) => {
    const [customer] = await tx
      .update(customers)
      .set({
        name: input.name,
        phone: input.phone ?? null,
        address: input.address ?? null,
        creditLimitCents: input.creditLimit ?? null,
      })
      .where(and(eq(customers.id, input.customerId), eq(customers.shopId, actor.shopId)))
      .returning();
    if (!customer) throw new DomainError('Customer not found');
    await audit(tx, actor, 'customer.update', 'customer', customer.id, input);
    return customer;
  });
}

export function updateSupplier(db: DB, actor: Actor, input: UpdateSupplierInput) {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({ price: suppliers.defaultPricePerLitreCents })
      .from(suppliers)
      .where(and(eq(suppliers.id, input.supplierId), eq(suppliers.shopId, actor.shopId)));
    if (!before) throw new DomainError('Supplier not found');
    const [supplier] = await tx
      .update(suppliers)
      .set({ name: input.name, phone: input.phone ?? null, defaultPricePerLitreCents: input.defaultPricePerLitre ?? null })
      .where(and(eq(suppliers.id, input.supplierId), eq(suppliers.shopId, actor.shopId)))
      .returning();
    await audit(tx, actor, 'supplier.update', 'supplier', supplier.id, {
      ...input,
      previousPricePerLitreCents: before.price,
    });
    return supplier;
  });
}

/** The selling price every attendant sale uses. Past sales keep their own price. */
export function setSalePrice(db: DB, actor: Actor, pricePerLitreCents: number) {
  return db.transaction(async (tx) => {
    const previous = await shopSalePrice(tx, actor);
    await tx.update(shops).set({ salePricePerLitreCents: pricePerLitreCents }).where(eq(shops.id, actor.shopId));
    await audit(tx, actor, 'shop.sale_price', 'shop', actor.shopId, {
      from: previous,
      to: pricePerLitreCents,
    });
  });
}

/** The owner's WhatsApp number for stock updates (E.164), or null to turn them off. */
export function setStockAlertPhone(db: DB, actor: Actor, phone: string | null) {
  return db.transaction(async (tx) => {
    if (!isManager(actor)) throw new DomainError('Only the owner can change notifications');
    if (phone && (await isDemoShop(tx, actor.shopId))) throw new DomainError(demoOff('WhatsApp stock updates'));
    const [previous] = await tx
      .select({ phone: shops.stockAlertWhatsapp })
      .from(shops)
      .where(eq(shops.id, actor.shopId));
    await tx.update(shops).set({ stockAlertWhatsapp: phone }).where(eq(shops.id, actor.shopId));
    await audit(tx, actor, 'shop.stock_alert_whatsapp', 'shop', actor.shopId, {
      from: previous?.phone ?? null,
      to: phone,
    });
  });
}

// --- products -------------------------------------------------------------------

export function createProduct(db: DB, actor: Actor, input: ProductInput) {
  return db.transaction(async (tx) => {
    const [product] = await tx
      .insert(products)
      .values({
        shopId: actor.shopId,
        name: input.name,
        unit: input.unit,
        salePriceCents: input.salePrice ?? null,
        costPriceCents: input.costPrice ?? null,
        reorderLevel: input.reorderLevel ?? null,
      })
      .returning();
    await audit(tx, actor, 'product.create', 'product', product.id, input);
    return product;
  });
}

/** Price changes apply to new entries only; the audit row keeps the old prices. */
export function updateProduct(db: DB, actor: Actor, input: UpdateProductInput) {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(products)
      .where(and(eq(products.id, input.productId), eq(products.shopId, actor.shopId)));
    if (!before) throw new DomainError('Product not found');
    if (before.unit !== input.unit) {
      const [used] = await tx
        .select({ id: ledgerEntries.id })
        .from(ledgerEntries)
        .where(and(eq(ledgerEntries.productId, before.id), eq(ledgerEntries.shopId, actor.shopId)))
        .limit(1);
      if (used) throw new DomainError("The unit can't change once the product has been bought or sold");
    }
    const [product] = await tx
      .update(products)
      .set({
        name: input.name,
        unit: input.unit,
        salePriceCents: input.salePrice ?? null,
        costPriceCents: input.costPrice ?? null,
        reorderLevel: input.reorderLevel ?? null,
      })
      .where(and(eq(products.id, input.productId), eq(products.shopId, actor.shopId)))
      .returning();
    await audit(tx, actor, 'product.update', 'product', product.id, {
      ...input,
      previousSalePriceCents: before.salePriceCents,
      previousCostPriceCents: before.costPriceCents,
    });
    return product;
  });
}

export function setProductArchived(db: DB, actor: Actor, productId: string, archived: boolean) {
  return db.transaction(async (tx) => {
    const [product] = await tx
      .update(products)
      .set({ archivedAt: archived ? sql`now()` : null })
      .where(and(eq(products.id, productId), eq(products.shopId, actor.shopId)))
      .returning();
    if (!product) throw new DomainError('Product not found');
    await audit(tx, actor, archived ? 'product.archive' : 'product.restore', 'product', product.id);
    return product;
  });
}

// --- shift close ----------------------------------------------------------------

/**
 * The seller's end-of-shift count. Covers everything recorded since the
 * previous close (or, for the shop's first close, today). Expected figures
 * are computed here and stored with the count, so later corrections never
 * rewrite a closed shift. Closes are serialised per shop by a row lock.
 */
export function submitShiftClose(db: DB, actor: Actor, input: ShiftCloseInput) {
  return db.transaction(async (tx) => {
    if (actor.role !== 'owner' && actor.role !== 'attendant') throw new DomainError('Only shop staff close a shift');
    await tx.select({ id: shops.id }).from(shops).where(eq(shops.id, actor.shopId)).for('update');
    const [last] = await tx
      .select({ closedAt: shiftCloses.closedAt })
      .from(shiftCloses)
      .where(eq(shiftCloses.shopId, actor.shopId))
      .orderBy(desc(shiftCloses.closedAt))
      .limit(1);
    const today = todayBusinessDate();
    const inWindow = last ? gt(ledgerEntries.createdAt, last.closedAt) : eq(ledgerEntries.businessDate, today);
    const money = await tx
      .select({
        kind: ledgerEntries.kind,
        paymentMethod: ledgerEntries.paymentMethod,
        amountCents: sql<number>`coalesce(sum(${ledgerEntries.amountCents}), 0)`.mapWith(Number),
      })
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.shopId, actor.shopId), inWindow))
      .groupBy(ledgerEntries.kind, ledgerEntries.paymentMethod);
    const [milk] = await tx
      .select({
        ml: sql<number>`coalesce(sum(case
          when ${ledgerEntries.kind} = 'delivery' then ${ledgerEntries.volumeMl}
          when ${ledgerEntries.kind} in ('sale', 'spoilage') then -${ledgerEntries.volumeMl}
          else 0 end), 0)`.mapWith(Number),
      })
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.shopId, actor.shopId), isNull(ledgerEntries.productId)));
    const takings = expectedTakings(money);
    const openingFloat = input.openingFloat ?? 0;

    const [close] = await tx
      .insert(shiftCloses)
      .values({
        shopId: actor.shopId,
        businessDate: today,
        periodStart: last?.closedAt ?? null,
        closedBy: actor.id!,
        openingFloatCents: openingFloat,
        expectedCashCents: openingFloat + takings.cashCents,
        countedCashCents: input.countedCash,
        expectedMpesaCents: takings.mpesaCents,
        countedMpesaCents: input.countedMpesa,
        expectedMilkMl: milk?.ml ?? 0,
        countedMilkMl: input.countedMilk,
        note: input.note ?? null,
      })
      .returning();
    await audit(tx, actor, 'shift.close', 'shift_close', close.id, {
      expectedCashCents: close.expectedCashCents,
      countedCashCents: close.countedCashCents,
      expectedMpesaCents: close.expectedMpesaCents,
      countedMpesaCents: close.countedMpesaCents,
      expectedMilkMl: close.expectedMilkMl,
      countedMilkMl: close.countedMilkMl,
    });
    return close;
  });
}

/**
 * The owner signs a close off. If milk came up short they can write the
 * shortfall off as spoilage in the same step, so stock matches the count.
 */
export function reviewShiftClose(db: DB, actor: Actor, input: ReviewShiftCloseInput) {
  return db.transaction(async (tx) => {
    if (!isManager(actor)) throw new DomainError('Only the owner signs off a shift close');
    const [close] = await tx
      .select()
      .from(shiftCloses)
      .where(and(eq(shiftCloses.id, input.closeId), eq(shiftCloses.shopId, actor.shopId)))
      .for('update');
    if (!close) throw new DomainError('Shift close not found');
    if (close.status !== 'submitted') throw new DomainError('This close was already signed off');

    const shortfallMl = close.expectedMilkMl - close.countedMilkMl;
    let spoilageEntryId: string | null = null;
    if (input.writeOffShortfall) {
      if (shortfallMl <= 0) throw new DomainError('There is no milk shortfall to write off');
      const entry = await insertEntry(tx, actor, {
        kind: 'spoilage',
        businessDate: close.businessDate,
        volumeMl: shortfallMl,
        expenseCategory: 'other',
        note: 'Shift close shortfall',
        idempotencyKey: `close:${close.id}`,
      });
      spoilageEntryId = entry.id;
    }
    const [reviewed] = await tx
      .update(shiftCloses)
      .set({
        status: 'approved',
        reviewedBy: actor.id,
        reviewedAt: sql`now()`,
        reviewNote: input.note ?? null,
        spoilageEntryId,
      })
      .where(and(eq(shiftCloses.id, close.id), eq(shiftCloses.shopId, actor.shopId)))
      .returning();
    await audit(tx, actor, 'shift.approve', 'shift_close', close.id, { spoilageEntryId, note: input.note });
    return reviewed;
  });
}

// --- finance ----------------------------------------------------------------------

/**
 * Pay several suppliers in one go (e.g. the weekly settlement). One entry per
 * supplier, all in one transaction. Keys derive from the form's `runKey`, so
 * a retried or double-tapped run pays nobody twice.
 */
export function paySuppliers(db: DB, actor: Actor, input: PaySuppliersInput) {
  return db.transaction(async (tx) => {
    if (!isManager(actor)) throw new DomainError('Only the owner pays suppliers');
    const lines = input.lines.filter((l): l is { supplierId: string; amount: number } => l.amount != null);
    if (new Set(lines.map((l) => l.supplierId)).size !== lines.length) {
      throw new DomainError('Each supplier can only appear once in a payment run');
    }
    const businessDate = todayBusinessDate();
    let paid = 0;
    let totalCents = 0;
    for (const line of lines) {
      const supplier = await assertSupplier(tx, actor, line.supplierId);
      const inserted = await tx
        .insert(ledgerEntries)
        .values({
          shopId: actor.shopId,
          kind: 'supplier_payment',
          businessDate,
          amountCents: line.amount,
          paymentMethod: input.paymentMethod,
          supplierId: line.supplierId,
          note: 'Payment run',
          idempotencyKey: `payrun:${input.runKey}:${line.supplierId}`,
          createdBy: actor.id,
        })
        .onConflictDoNothing({ target: ledgerEntries.idempotencyKey })
        .returning({ id: ledgerEntries.id });
      if (inserted.length === 0) continue;
      await audit(tx, actor, 'ledger.supplier_payment', 'ledger_entry', inserted[0].id, {
        amountCents: line.amount,
        paymentMethod: input.paymentMethod,
        supplier: supplier.name,
        runKey: input.runKey,
      });
      paid += 1;
      totalCents += line.amount;
    }
    return { paid, totalCents };
  });
}

/** Set (or clear, with a blank) each category's monthly budget. */
export function setBudgets(db: DB, actor: Actor, input: BudgetsInput) {
  return db.transaction(async (tx) => {
    if (!isManager(actor)) throw new DomainError('Only the owner sets budgets');
    for (const b of input.budgets) {
      if (b.monthly == null) {
        await tx
          .delete(expenseBudgets)
          .where(and(eq(expenseBudgets.shopId, actor.shopId), eq(expenseBudgets.category, b.category)));
      } else {
        await tx
          .insert(expenseBudgets)
          .values({ shopId: actor.shopId, category: b.category, monthlyCents: b.monthly })
          .onConflictDoUpdate({
            target: [expenseBudgets.shopId, expenseBudgets.category],
            set: { monthlyCents: b.monthly, updatedAt: sql`now()` },
          });
      }
    }
    await audit(tx, actor, 'budgets.set', 'shop', actor.shopId, input.budgets);
  });
}

// --- staff & payroll ----------------------------------------------------------------

async function assertEmployee(tx: Tx, actor: Actor, employeeId: string) {
  const [row] = await tx
    .select()
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.shopId, actor.shopId)));
  if (!row) throw new DomainError('Staff member not found');
  return row;
}

function ownerOnly(actor: Actor, what: string) {
  if (!isManager(actor)) throw new DomainError(`Only the owner ${what}`);
}

export function createEmployee(db: DB, actor: Actor, input: EmployeeInput) {
  return db.transaction(async (tx) => {
    ownerOnly(actor, 'manages staff');
    const [employee] = await tx
      .insert(employees)
      .values({
        shopId: actor.shopId,
        name: input.name,
        phone: input.phone ?? null,
        payType: input.payType,
        rateCents: input.rate,
        startDate: input.startDate ?? todayBusinessDate(),
        statutory: input.statutory,
        kraPin: input.kraPin ?? null,
        nssfNumber: input.nssfNumber ?? null,
        shaNumber: input.shaNumber ?? null,
      })
      .returning();
    await audit(tx, actor, 'employee.create', 'employee', employee.id, input);
    return employee;
  });
}

export function updateEmployee(db: DB, actor: Actor, input: UpdateEmployeeInput) {
  return db.transaction(async (tx) => {
    ownerOnly(actor, 'manages staff');
    const before = await assertEmployee(tx, actor, input.employeeId);
    const [employee] = await tx
      .update(employees)
      .set({
        name: input.name,
        phone: input.phone ?? null,
        payType: input.payType,
        rateCents: input.rate,
        startDate: input.startDate ?? before.startDate,
        statutory: input.statutory,
        kraPin: input.kraPin ?? null,
        nssfNumber: input.nssfNumber ?? null,
        shaNumber: input.shaNumber ?? null,
      })
      .where(and(eq(employees.id, input.employeeId), eq(employees.shopId, actor.shopId)))
      .returning();
    await audit(tx, actor, 'employee.update', 'employee', employee.id, { ...input, previousRateCents: before.rateCents });
    return employee;
  });
}

export function setEmployeeActive(db: DB, actor: Actor, employeeId: string, active: boolean) {
  return db.transaction(async (tx) => {
    ownerOnly(actor, 'manages staff');
    await assertEmployee(tx, actor, employeeId);
    await tx
      .update(employees)
      .set({ active })
      .where(and(eq(employees.id, employeeId), eq(employees.shopId, actor.shopId)));
    await audit(tx, actor, active ? 'employee.activate' : 'employee.deactivate', 'employee', employeeId);
  });
}

/** Mark someone present (or not) on a day. Idempotent either way. */
export function setAttendance(db: DB, actor: Actor, input: AttendanceInput) {
  return db.transaction(async (tx) => {
    ownerOnly(actor, 'marks attendance');
    const employee = await assertEmployee(tx, actor, input.employeeId);
    const businessDate = entryDateFor(actor, input.date);
    if (input.present) {
      if (!employee.active) throw new DomainError(`${employee.name} is no longer on the team`);
      await tx
        .insert(attendance)
        .values({ shopId: actor.shopId, employeeId: employee.id, businessDate, markedBy: actor.id })
        .onConflictDoNothing({ target: [attendance.employeeId, attendance.businessDate] });
    } else {
      await tx
        .delete(attendance)
        .where(
          and(
            eq(attendance.shopId, actor.shopId),
            eq(attendance.employeeId, employee.id),
            eq(attendance.businessDate, businessDate),
          ),
        );
    }
    await audit(tx, actor, input.present ? 'attendance.present' : 'attendance.absent', 'employee', employee.id, {
      businessDate,
    });
  });
}

/** Money paid to a staff member before payday: a wages expense now, deducted at payroll. */
export function giveAdvance(db: DB, actor: Actor, input: AdvanceInput) {
  return db.transaction(async (tx) => {
    ownerOnly(actor, 'gives advances');
    const employee = await assertEmployee(tx, actor, input.employeeId);
    const businessDate = entryDateFor(actor, undefined);
    const entry = await insertEntry(tx, actor, {
      kind: 'expense',
      businessDate,
      amountCents: input.amount,
      paymentMethod: input.paymentMethod,
      expenseCategory: 'wages',
      note: `Advance: ${employee.name}${input.note ? ` (${input.note})` : ''}`,
    });
    const [advance] = await tx
      .insert(employeeAdvances)
      .values({
        shopId: actor.shopId,
        employeeId: employee.id,
        businessDate,
        amountCents: input.amount,
        note: input.note ?? null,
        ledgerEntryId: entry.id,
        createdBy: actor.id,
      })
      .returning();
    await audit(tx, actor, 'employee.advance', 'employee', employee.id, { amountCents: input.amount, advanceId: advance.id });
    return advance;
  });
}

export interface PayrollPreviewLine extends PayLine {
  employeeId: string;
  name: string;
  payType: PayType;
  rateCents: number;
  statutory: boolean;
}

/**
 * What each person is owed for a month: active staff, plus anyone who worked
 * or took an advance that month. Shared by the preview and by posting.
 */
export async function payrollPreview(q: DB | Tx, shopId: string, month: string): Promise<PayrollPreviewLine[]> {
  const from = `${month}-01`;
  const lastDay = monthLastDay(month);
  const [staff, days, advances] = await Promise.all([
    q.select().from(employees).where(eq(employees.shopId, shopId)).orderBy(employees.name),
    q
      .select({ employeeId: attendance.employeeId, days: sql<number>`count(*)`.mapWith(Number) })
      .from(attendance)
      .where(and(eq(attendance.shopId, shopId), gte(attendance.businessDate, from), lte(attendance.businessDate, lastDay)))
      .groupBy(attendance.employeeId),
    q
      .select({ employeeId: employeeAdvances.employeeId, cents: sql<number>`coalesce(sum(${employeeAdvances.amountCents}), 0)`.mapWith(Number) })
      .from(employeeAdvances)
      .where(
        and(
          eq(employeeAdvances.shopId, shopId),
          isNull(employeeAdvances.settledInRunId),
          lte(employeeAdvances.businessDate, lastDay),
        ),
      )
      .groupBy(employeeAdvances.employeeId),
  ]);
  const daysOf = new Map(days.map((d) => [d.employeeId, d.days]));
  const advancesOf = new Map(advances.map((a) => [a.employeeId, a.cents]));
  return staff
    .filter((e) => (e.active && e.startDate <= lastDay) || daysOf.has(e.id) || advancesOf.has(e.id))
    .map((e) => ({
      employeeId: e.id,
      name: e.name,
      payType: e.payType,
      rateCents: e.rateCents,
      statutory: e.statutory,
      ...computePay(
        {
          payType: e.payType,
          // Someone who has left gets day pay for days marked, but no salary.
          rateCents: e.active || e.payType === 'daily' ? e.rateCents : 0,
          startDate: e.startDate,
          daysWorked: daysOf.get(e.id) ?? 0,
          advancesCents: advancesOf.get(e.id) ?? 0,
          statutory: e.statutory,
        },
        { from, lastDay },
      ),
    }));
}

const monthLastDay = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return addDays(m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`, -1);
};

/**
 * Pay a month's wages: one run per month, each line's net pay posted as a
 * `wages` expense, advances marked settled (any excess carried forward).
 */
export function postPayroll(db: DB, actor: Actor, input: PostPayrollInput) {
  return db.transaction(async (tx) => {
    ownerOnly(actor, 'runs payroll');
    if (input.month > todayBusinessDate().slice(0, 7)) throw new DomainError("You can't pay a month that hasn't started");
    const [existing] = await tx
      .select({ id: payrollRuns.id })
      .from(payrollRuns)
      .where(and(eq(payrollRuns.shopId, actor.shopId), eq(payrollRuns.month, input.month)));
    if (existing) throw new DomainError('Payroll for this month has already been paid');
    const lines = (await payrollPreview(tx, actor.shopId, input.month)).filter(
      (l) => l.grossCents > 0 || l.advancesCents > 0 || l.carryForwardCents > 0,
    );
    if (lines.length === 0) throw new DomainError('Nobody is due any pay for this month');

    const sum = (k: keyof PayLine) => lines.reduce((n, l) => n + l[k], 0);
    const [run] = await tx
      .insert(payrollRuns)
      .values({
        shopId: actor.shopId,
        month: input.month,
        paymentMethod: input.paymentMethod,
        grossCents: sum('grossCents'),
        advancesCents: sum('advancesCents'),
        netCents: sum('netCents'),
        statutoryDueCents:
          sum('employeeTotalCents') + sum('employerNssfCents') + sum('employerHousingLevyCents') + sum('employerNitaCents'),
        postedBy: actor.id,
      })
      .returning();

    const lastDay = monthLastDay(input.month);
    const payDate = lastDay < todayBusinessDate() ? lastDay : todayBusinessDate();
    for (const line of lines) {
      const entry =
        line.netCents > 0
          ? await insertEntry(tx, actor, {
              kind: 'expense',
              businessDate: payDate,
              amountCents: line.netCents,
              paymentMethod: input.paymentMethod,
              expenseCategory: 'wages',
              note: `Wages ${input.month}: ${line.name}`,
              idempotencyKey: `payroll:${run.id}:${line.employeeId}`,
            })
          : null;
      await tx.insert(payrollLines).values({
        shopId: actor.shopId,
        runId: run.id,
        employeeId: line.employeeId,
        daysWorked: line.daysWorked,
        grossCents: line.grossCents,
        advancesCents: line.advancesCents,
        netCents: line.netCents,
        nssfCents: line.nssfCents,
        shifCents: line.shifCents,
        housingLevyCents: line.housingLevyCents,
        taxableCents: line.taxableCents,
        payeCents: line.payeCents,
        employerNssfCents: line.employerNssfCents,
        employerHousingLevyCents: line.employerHousingLevyCents,
        employerNitaCents: line.employerNitaCents,
        ledgerEntryId: entry?.id ?? null,
      });
      await tx
        .update(employeeAdvances)
        .set({ settledInRunId: run.id })
        .where(
          and(
            eq(employeeAdvances.shopId, actor.shopId),
            eq(employeeAdvances.employeeId, line.employeeId),
            isNull(employeeAdvances.settledInRunId),
            lte(employeeAdvances.businessDate, lastDay),
          ),
        );
      if (line.carryForwardCents > 0) {
        await tx.insert(employeeAdvances).values({
          shopId: actor.shopId,
          employeeId: line.employeeId,
          businessDate: addDays(lastDay, 1),
          amountCents: line.carryForwardCents,
          note: `Carried forward from ${input.month}`,
          createdBy: actor.id,
        });
      }
    }
    await audit(tx, actor, 'payroll.post', 'payroll_run', run.id, {
      month: input.month,
      lines: lines.length,
      netCents: run.netCents,
    });
    return run;
  });
}

/**
 * Record paying the month's NSSF, SHIF, housing levy and PAYE over to the
 * authorities (due by the 9th of the next month). Posted then, not at
 * payroll, so cash counts stay true until the money actually leaves.
 */
export function remitStatutory(db: DB, actor: Actor, input: RemitStatutoryInput) {
  return db.transaction(async (tx) => {
    ownerOnly(actor, 'records statutory payments');
    const [run] = await tx
      .select()
      .from(payrollRuns)
      .where(and(eq(payrollRuns.id, input.runId), eq(payrollRuns.shopId, actor.shopId)))
      .for('update');
    if (!run) throw new DomainError('Payroll not found');
    if (run.statutoryDueCents <= 0) throw new DomainError('Nothing statutory is due for this payroll');
    if (run.remittedAt) throw new DomainError('These deductions were already paid over');
    const entry = await insertEntry(tx, actor, {
      kind: 'expense',
      businessDate: todayBusinessDate(),
      amountCents: run.statutoryDueCents,
      paymentMethod: input.paymentMethod,
      expenseCategory: 'statutory',
      note: `PAYE, NSSF, SHIF, housing and NITA levies for ${run.month}`,
      idempotencyKey: `remit:${run.id}`,
    });
    const [updated] = await tx
      .update(payrollRuns)
      .set({ remittedAt: sql`now()`, remittanceEntryId: entry.id })
      .where(and(eq(payrollRuns.id, run.id), eq(payrollRuns.shopId, actor.shopId)))
      .returning();
    await audit(tx, actor, 'payroll.remit', 'payroll_run', run.id, { amountCents: run.statutoryDueCents });
    return updated;
  });
}

// --- M-Pesa (STK Push) ---------------------------------------------------------------

/**
 * Post a confirmed M-Pesa prompt to the ledger: the sale or customer payment
 * it was for, at the amount and price fixed when it was sent. Called inside
 * the transaction that marks the request paid; keyed by request, so it can
 * only ever post once.
 */
export async function postMpesaRequest(tx: Tx, request: MpesaRequest, receiptNumber: string | null) {
  // Recorded on behalf of whoever sent the prompt, with the price already settled.
  const actor: Actor = { id: request.createdBy, role: 'system', shopId: request.shopId };
  const note = [receiptNumber ? `M-Pesa ${receiptNumber}` : 'M-Pesa', request.note].filter(Boolean).join(' · ');
  return insertEntry(tx, actor, {
    kind: request.purpose === 'sale' ? 'sale' : 'customer_payment',
    businessDate: request.businessDate,
    productId: request.productId,
    volumeMl: request.purpose === 'sale' ? request.volumeMl : 0,
    unitPriceCents: request.purpose === 'sale' ? request.unitPriceCents : null,
    amountCents: request.amountCents,
    paymentMethod: 'mpesa',
    customerId: request.customerId,
    note,
    idempotencyKey: `mpesa:${request.id}`,
  });
}

/**
 * Post a till/paybill payment as a customer paying down their deni. Keyed by
 * Safaricom's receipt, so the same payment can never be posted twice.
 */
export async function postC2bCustomerPayment(tx: Tx, c2b: C2bTransaction, customerId: string, byUserId: string | null) {
  const actor: Actor = { id: byUserId, role: 'system', shopId: c2b.shopId };
  await assertCustomer(tx, actor, customerId);
  return insertEntry(tx, actor, {
    kind: 'customer_payment',
    businessDate: c2b.businessDate,
    occurredAt: c2b.transTime,
    amountCents: c2b.amountCents,
    paymentMethod: 'mpesa',
    customerId,
    note: `M-Pesa ${c2b.transId} (paid to till)`,
    idempotencyKey: `c2b:${c2b.transId}`,
  });
}
