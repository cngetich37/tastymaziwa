/**
 * Ledger write services. The only code that inserts into the ledger. Each
 * function runs in one DB transaction and writes an audit row alongside the
 * change. Callers (server actions, cron routes, scripts) handle auth.
 */
import { and, eq, lte, sql } from 'drizzle-orm';
import type { DB, Tx } from '@/db/client';
import {
  auditLog,
  customers,
  deliverySubmissions,
  ledgerEntries,
  products,
  shops,
  subscriptions,
  suppliers,
  users,
  type LedgerEntry,
  type NewLedgerEntry,
  type Role,
} from '@/db/schema';
import { addDays, todayBusinessDate, type BusinessDate } from '@/lib/dates';
import { lineTotalCents } from '@/lib/money';
import type {
  CustomerInput,
  CustomerPaymentInput,
  ProductInput,
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

async function assertCustomer(tx: Tx, actor: Actor, customerId: string) {
  const [row] = await tx
    .select({ id: customers.id, archivedAt: customers.archivedAt })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.shopId, actor.shopId)));
  if (!row) throw new DomainError('Customer not found');
  if (row.archivedAt) throw new DomainError('That customer has been archived');
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

export function recordSale(db: DB, actor: Actor, input: SaleInput) {
  return db.transaction(async (tx) => {
    const businessDate = entryDateFor(actor, input.date);
    if (input.customerId) await assertCustomer(tx, actor, input.customerId);
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
    const isCredit = input.paymentMethod === 'credit';
    return insertEntry(tx, actor, {
      kind: 'sale',
      businessDate,
      productId: product?.id ?? null,
      volumeMl: input.litres,
      unitPriceCents: price,
      amountCents: lineTotalCents(input.litres, price),
      paymentMethod: input.paymentMethod,
      customerId: input.customerId ?? null,
      dueDate: isCredit ? (input.dueDate ?? addDays(businessDate, DEFAULT_CREDIT_DAYS)) : null,
      note: input.note,
    });
  });
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
      .set({ name: input.name, phone: input.phone ?? null, address: input.address ?? null })
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
