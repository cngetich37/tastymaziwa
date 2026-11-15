/**
 * Read models for the UI. Aggregation happens in SQL; derived figures come
 * from the pure functions in src/lib/calc so they are unit-tested.
 *
 * Every query takes a `shopId` and filters by it: tenants never see each
 * other's data. Joins stay within a shop because of the composite FKs.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { DB } from '@/db/client';
import {
  attendance,
  customers,
  employeeAdvances,
  employees,
  payrollLines,
  payrollRuns,
  deliverySubmissions,
  expenseBudgets,
  ledgerEntries,
  products,
  shiftCloses,
  shops,
  subscriptions,
  suppliers,
  users,
  type ProductUnit,
} from '@/db/schema';
import { allocatePayments, type AllocatedCreditSale } from '@/lib/calc/allocation';
import { statementForPeriod, withRunningBalance } from '@/lib/calc/statement';
import { isLowStock } from '@/lib/calc/stock-alert';
import {
  customerBalanceCents,
  dailySeries,
  summarize,
  supplierPayableCents,
  type DailyPoint,
  type LedgerRow,
  type Summary,
} from '@/lib/calc/summary';
import { addDays, daysBetween, lastNDates, todayBusinessDate, type BusinessDate } from '@/lib/dates';

const sumAmount = sql<number>`coalesce(sum(${ledgerEntries.amountCents}), 0)`.mapWith(Number);
const sumVolume = sql<number>`coalesce(sum(${ledgerEntries.volumeMl}), 0)`.mapWith(Number);

/** Ledger totals grouped by kind and payment method, plus any extra group-by columns. */
async function aggregate(db: DB, shopId: string, where?: SQL): Promise<LedgerRow[]> {
  return db
    .select({
      kind: ledgerEntries.kind,
      paymentMethod: ledgerEntries.paymentMethod,
      productId: ledgerEntries.productId,
      amountCents: sumAmount,
      volumeMl: sumVolume,
    })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.shopId, shopId), where))
    .groupBy(ledgerEntries.kind, ledgerEntries.paymentMethod, ledgerEntries.productId);
}

// --- dashboard --------------------------------------------------------------

export interface Dashboard {
  today: BusinessDate;
  todaySummary: Summary;
  weekSummary: Summary;
  series: DailyPoint[];
  stockOnHandMl: number;
  receivablesCents: number;
  payablesCents: number;
  activeSubscriptions: number;
}

export async function getDashboard(db: DB, shopId: string, today = todayBusinessDate()): Promise<Dashboard> {
  const dates = lastNDates(7, today);
  const [todayRows, seriesRows, allTimeRows, [subs]] = await Promise.all([
    aggregate(db, shopId, eq(ledgerEntries.businessDate, today)),
    db
      .select({
        businessDate: ledgerEntries.businessDate,
        kind: ledgerEntries.kind,
        paymentMethod: ledgerEntries.paymentMethod,
        productId: ledgerEntries.productId,
        amountCents: sumAmount,
        volumeMl: sumVolume,
      })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.shopId, shopId),
          gte(ledgerEntries.businessDate, dates[0]),
          lte(ledgerEntries.businessDate, today),
        ),
      )
      .groupBy(ledgerEntries.businessDate, ledgerEntries.kind, ledgerEntries.paymentMethod, ledgerEntries.productId),
    aggregate(db, shopId),
    db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(subscriptions)
      .where(and(eq(subscriptions.shopId, shopId), eq(subscriptions.status, 'active'))),
  ]);

  const allTime = summarize(allTimeRows);
  return {
    today,
    todaySummary: summarize(todayRows),
    weekSummary: summarize(seriesRows),
    series: dailySeries(dates, seriesRows),
    stockOnHandMl: allTime.stockChangeMl,
    receivablesCents: allTime.creditSalesCents - allTime.customerPaymentsCents,
    payablesCents: allTime.deliveryCostCents - allTime.supplierPaymentsCents,
    activeSubscriptions: subs?.count ?? 0,
  };
}

// --- ledger listing ---------------------------------------------------------

export interface LedgerListItem {
  id: string;
  kind: LedgerRow['kind'];
  businessDate: BusinessDate;
  occurredAt: Date;
  volumeMl: number;
  amountCents: number;
  unitPriceCents: number | null;
  paymentMethod: LedgerRow['paymentMethod'];
  /** Null = fresh milk (litres). */
  productName: string | null;
  productUnit: ProductUnit | null;
  customerName: string | null;
  supplierName: string | null;
  category: string | null;
  note: string | null;
  createdByName: string | null;
  reversesId: string | null;
  reversedById: string | null;
}

export interface EntryFilter {
  limit?: number;
  offset?: number;
  /** Only these kinds (e.g. the Sales page lists sales). */
  kinds?: LedgerListItem['kind'][];
  /** Only one business day. */
  date?: BusinessDate;
  /** Or a range of business days (inclusive). */
  from?: BusinessDate;
  to?: BusinessDate;
  customerId?: string;
  supplierId?: string;
  /** Oldest first (statements); newest first by default. */
  oldestFirst?: boolean;
}

export async function listEntries(
  db: DB,
  shopId: string,
  { limit = 50, offset = 0, kinds, date, from, to, customerId, supplierId, oldestFirst = false }: EntryFilter = {},
): Promise<LedgerListItem[]> {
  const reversal = alias(ledgerEntries, 'reversal');
  return db
    .select({
      id: ledgerEntries.id,
      kind: ledgerEntries.kind,
      businessDate: ledgerEntries.businessDate,
      occurredAt: ledgerEntries.occurredAt,
      volumeMl: ledgerEntries.volumeMl,
      amountCents: ledgerEntries.amountCents,
      unitPriceCents: ledgerEntries.unitPriceCents,
      paymentMethod: ledgerEntries.paymentMethod,
      productName: products.name,
      productUnit: products.unit,
      customerName: customers.name,
      supplierName: suppliers.name,
      category: ledgerEntries.expenseCategory,
      note: ledgerEntries.note,
      createdByName: users.name,
      reversesId: ledgerEntries.reversesId,
      reversedById: reversal.id,
    })
    .from(ledgerEntries)
    .leftJoin(customers, eq(customers.id, ledgerEntries.customerId))
    .leftJoin(suppliers, eq(suppliers.id, ledgerEntries.supplierId))
    .leftJoin(products, eq(products.id, ledgerEntries.productId))
    .leftJoin(users, eq(users.id, ledgerEntries.createdBy))
    .leftJoin(reversal, eq(reversal.reversesId, ledgerEntries.id))
    .where(
      and(
        eq(ledgerEntries.shopId, shopId),
        kinds?.length ? inArray(ledgerEntries.kind, kinds) : undefined,
        date ? eq(ledgerEntries.businessDate, date) : undefined,
        from ? gte(ledgerEntries.businessDate, from) : undefined,
        to ? lte(ledgerEntries.businessDate, to) : undefined,
        customerId ? eq(ledgerEntries.customerId, customerId) : undefined,
        supplierId ? eq(ledgerEntries.supplierId, supplierId) : undefined,
      ),
    )
    .orderBy(
      ...(oldestFirst
        ? [asc(ledgerEntries.occurredAt), asc(ledgerEntries.createdAt)]
        : [desc(ledgerEntries.occurredAt), desc(ledgerEntries.createdAt)]),
    )
    .limit(limit)
    .offset(offset);
}

// --- customers & credit -----------------------------------------------------

export interface CustomerWithBalance {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  balanceCents: number;
  creditLimitCents: number | null;
  subscription: { id: string; dailyMl: number; pricePerLitreCents: number; status: string } | null;
}

export async function listCustomers(db: DB, shopId: string): Promise<CustomerWithBalance[]> {
  const [rows, totals, subs] = await Promise.all([
    db
      .select()
      .from(customers)
      .where(and(eq(customers.shopId, shopId), isNull(customers.archivedAt)))
      .orderBy(customers.name),
    db
      .select({
        customerId: ledgerEntries.customerId,
        kind: ledgerEntries.kind,
        paymentMethod: ledgerEntries.paymentMethod,
        amountCents: sumAmount,
        volumeMl: sumVolume,
      })
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.shopId, shopId), sql`${ledgerEntries.customerId} is not null`))
      .groupBy(ledgerEntries.customerId, ledgerEntries.kind, ledgerEntries.paymentMethod),
    db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.shopId, shopId), sql`${subscriptions.status} <> 'cancelled'`))
      .orderBy(desc(subscriptions.createdAt)),
  ]);

  const byCustomer = Map.groupBy(totals, (t) => t.customerId);
  return rows.map((c) => {
    const sub = subs.find((s) => s.customerId === c.id);
    return {
      id: c.id,
      name: c.name,
      phone: c.phone,
      address: c.address,
      balanceCents: customerBalanceCents(byCustomer.get(c.id) ?? []),
      creditLimitCents: c.creditLimitCents,
      subscription: sub
        ? {
            id: sub.id,
            dailyMl: sub.dailyMl,
            pricePerLitreCents: sub.pricePerLitreCents,
            status: sub.status,
          }
        : null,
    };
  });
}

export interface OutstandingCredit extends AllocatedCreditSale {
  customerId: string;
  customerName: string;
  volumeMl: number;
  daysOverdue: number;
}

/**
 * Every credit sale that is not fully paid, after applying each customer's
 * payments oldest-first. Reversed sales are excluded.
 */
export async function getOutstandingCredit(
  db: DB,
  shopId: string,
  today = todayBusinessDate(),
): Promise<OutstandingCredit[]> {
  const reversal = alias(ledgerEntries, 'reversal');
  const [sales, payments] = await Promise.all([
    db
      .select({
        id: ledgerEntries.id,
        customerId: ledgerEntries.customerId,
        customerName: customers.name,
        businessDate: ledgerEntries.businessDate,
        occurredAt: ledgerEntries.occurredAt,
        dueDate: ledgerEntries.dueDate,
        amountCents: ledgerEntries.amountCents,
        volumeMl: ledgerEntries.volumeMl,
      })
      .from(ledgerEntries)
      .innerJoin(customers, eq(customers.id, ledgerEntries.customerId))
      .leftJoin(reversal, eq(reversal.reversesId, ledgerEntries.id))
      .where(
        and(
          eq(ledgerEntries.shopId, shopId),
          eq(ledgerEntries.kind, 'sale'),
          eq(ledgerEntries.paymentMethod, 'credit'),
          isNull(ledgerEntries.reversesId),
          isNull(reversal.id),
        ),
      ),
    db
      .select({ customerId: ledgerEntries.customerId, amountCents: sumAmount })
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.shopId, shopId), eq(ledgerEntries.kind, 'customer_payment')))
      .groupBy(ledgerEntries.customerId),
  ]);

  const paidBy = new Map(payments.map((p) => [p.customerId, p.amountCents]));
  const result: OutstandingCredit[] = [];
  for (const [customerId, customerSales] of Map.groupBy(sales, (s) => s.customerId!)) {
    const { sales: allocated } = allocatePayments(customerSales, paidBy.get(customerId) ?? 0);
    for (const sale of allocated) {
      if (sale.status === 'paid') continue;
      const original = customerSales.find((s) => s.id === sale.id)!;
      result.push({
        ...sale,
        customerId,
        customerName: original.customerName,
        volumeMl: original.volumeMl,
        daysOverdue: sale.dueDate ? Math.max(0, daysBetween(sale.dueDate, today)) : 0,
      });
    }
  }
  return result.sort(
    (a, b) => b.daysOverdue - a.daysOverdue || a.businessDate.localeCompare(b.businessDate),
  );
}

// --- suppliers --------------------------------------------------------------

export interface SupplierWithPayable {
  id: string;
  name: string;
  phone: string | null;
  defaultPricePerLitreCents: number | null;
  payableCents: number;
}

export async function listSuppliers(db: DB, shopId: string): Promise<SupplierWithPayable[]> {
  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.shopId, shopId), isNull(suppliers.archivedAt)))
      .orderBy(suppliers.name),
    db
      .select({
        supplierId: ledgerEntries.supplierId,
        kind: ledgerEntries.kind,
        paymentMethod: ledgerEntries.paymentMethod,
        amountCents: sumAmount,
        volumeMl: sumVolume,
      })
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.shopId, shopId), sql`${ledgerEntries.supplierId} is not null`))
      .groupBy(ledgerEntries.supplierId, ledgerEntries.kind, ledgerEntries.paymentMethod),
  ]);
  const bySupplier = Map.groupBy(totals, (t) => t.supplierId);
  return rows.map((s) => ({
    id: s.id,
    name: s.name,
    phone: s.phone,
    defaultPricePerLitreCents: s.defaultPricePerLitreCents,
    payableCents: supplierPayableCents(bySupplier.get(s.id) ?? []),
  }));
}

// --- form defaults ----------------------------------------------------------

/** Price of the most recent walk-in sale, so the sale form pre-fills sensibly. */
// --- day pages ----------------------------------------------------------------

/** Totals for one business day (Sales and Deliveries pages). */
export async function getDaySummary(db: DB, shopId: string, date: BusinessDate): Promise<Summary> {
  return summarize(await aggregate(db, shopId, eq(ledgerEntries.businessDate, date)));
}

/** Litres and cost delivered on one day, per supplier. */
export async function getDeliveriesBySupplier(db: DB, shopId: string, date: BusinessDate) {
  return db
    .select({
      supplierId: ledgerEntries.supplierId,
      name: suppliers.name,
      volumeMl: sumVolume,
      amountCents: sumAmount,
    })
    .from(ledgerEntries)
    .innerJoin(suppliers, eq(suppliers.id, ledgerEntries.supplierId))
    .where(
      and(
        eq(ledgerEntries.shopId, shopId),
        eq(ledgerEntries.kind, 'delivery'),
        eq(ledgerEntries.businessDate, date),
        isNull(ledgerEntries.productId),
      ),
    )
    .groupBy(ledgerEntries.supplierId, suppliers.name)
    .orderBy(suppliers.name);
}

/** All-time stock on hand: delivered − sold − spoiled. */
export async function getStockOnHandMl(db: DB, shopId: string): Promise<number> {
  return summarize(await aggregate(db, shopId)).stockChangeMl;
}

// --- customer and supplier pages ---------------------------------------------

export async function getCustomer(db: DB, shopId: string, customerId: string) {
  const [customer] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.shopId, shopId)));
  if (!customer) return null;
  const [totals, [sub]] = await Promise.all([
    aggregate(db, shopId, eq(ledgerEntries.customerId, customerId)),
    db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.customerId, customerId),
          eq(subscriptions.shopId, shopId),
          sql`${subscriptions.status} <> 'cancelled'`,
        ),
      )
      .orderBy(desc(subscriptions.createdAt))
      .limit(1),
  ]);
  return { ...customer, balanceCents: customerBalanceCents(totals), subscription: sub ?? null };
}

export async function getSupplier(db: DB, shopId: string, supplierId: string) {
  const [supplier] = await db
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.id, supplierId), eq(suppliers.shopId, shopId)));
  if (!supplier) return null;
  const totals = await aggregate(db, shopId, eq(ledgerEntries.supplierId, supplierId));
  return { ...supplier, payableCents: supplierPayableCents(totals) };
}

/**
 * A customer's or supplier's account, newest first, each line with the
 * balance owed after it. Computed over the whole account so the running
 * balance is right, then trimmed to the latest `limit` lines.
 */
export async function getStatement(
  db: DB,
  shopId: string,
  party: { customerId: string } | { supplierId: string },
  limit = 100,
) {
  const kinds: LedgerListItem['kind'][] =
    'customerId' in party ? ['sale', 'customer_payment'] : ['delivery', 'supplier_payment'];
  const rows = await listEntries(db, shopId, { ...party, kinds, oldestFirst: true, limit: 100_000 });
  return withRunningBalance(rows, 'customerId' in party ? 'customer' : 'supplier')
    .reverse()
    .slice(0, limit);
}

// --- supplier-recorded deliveries ---------------------------------------------

export interface DeliverySubmissionItem {
  id: string;
  supplierId: string;
  supplierName: string;
  businessDate: BusinessDate;
  submittedAt: Date;
  volumeMl: number;
  note: string | null;
  status: 'pending' | 'approved' | 'rejected';
  submittedByName: string;
  reviewedByName: string | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
}

/**
 * Supplier deliveries, newest first. `pending` is the seller's to-do list;
 * a date range feeds the approvals report; `supplierId` is a supplier's own view.
 */
export async function listDeliverySubmissions(
  db: DB,
  shopId: string,
  filter: {
    status?: DeliverySubmissionItem['status'];
    supplierId?: string;
    from?: BusinessDate;
    to?: BusinessDate;
    limit?: number;
  } = {},
): Promise<DeliverySubmissionItem[]> {
  const submitter = alias(users, 'submitter');
  const reviewer = alias(users, 'reviewer');
  return db
    .select({
      id: deliverySubmissions.id,
      supplierId: deliverySubmissions.supplierId,
      supplierName: suppliers.name,
      businessDate: deliverySubmissions.businessDate,
      submittedAt: deliverySubmissions.submittedAt,
      volumeMl: deliverySubmissions.volumeMl,
      note: deliverySubmissions.note,
      status: deliverySubmissions.status,
      submittedByName: submitter.name,
      reviewedByName: reviewer.name,
      reviewedAt: deliverySubmissions.reviewedAt,
      reviewNote: deliverySubmissions.reviewNote,
    })
    .from(deliverySubmissions)
    .innerJoin(suppliers, eq(suppliers.id, deliverySubmissions.supplierId))
    .innerJoin(submitter, eq(submitter.id, deliverySubmissions.submittedBy))
    .leftJoin(reviewer, eq(reviewer.id, deliverySubmissions.reviewedBy))
    .where(
      and(
        eq(deliverySubmissions.shopId, shopId),
        filter.status ? eq(deliverySubmissions.status, filter.status) : undefined,
        filter.supplierId ? eq(deliverySubmissions.supplierId, filter.supplierId) : undefined,
        filter.from ? gte(deliverySubmissions.businessDate, filter.from) : undefined,
        filter.to ? lte(deliverySubmissions.businessDate, filter.to) : undefined,
      ),
    )
    .orderBy(desc(deliverySubmissions.submittedAt))
    .limit(filter.limit ?? 200);
}

/** Supplier ids in this shop that have their own login (active or not), with its state. */
export async function getSupplierLogins(db: DB, shopId: string) {
  const rows = await db
    .select({
      supplierId: users.supplierId,
      userId: users.id,
      email: users.email,
      active: users.active,
      joined: sql<boolean>`${users.passwordHash} is not null or ${users.emailVerifiedAt} is not null`,
    })
    .from(users)
    .where(and(eq(users.shopId, shopId), eq(users.role, 'supplier')));
  return new Map(rows.map(({ supplierId, ...login }) => [supplierId!, login]));
}

/**
 * Everything a supplier's own page shows: who they are to this shop, their
 * agreed price, what the shop owes them, and their recent deliveries with
 * the seller's decision. Scoped to the supplier the login belongs to.
 */
export async function getSupplierPortal(db: DB, shopId: string, userId: string) {
  const [me] = await db
    .select({ supplierId: users.supplierId })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.shopId, shopId)));
  if (!me?.supplierId) return null;
  const [supplier, shop, submissions] = await Promise.all([
    getSupplier(db, shopId, me.supplierId),
    getShop(db, shopId),
    listDeliverySubmissions(db, shopId, { supplierId: me.supplierId, limit: 60 }),
  ]);
  if (!supplier) return null;
  return {
    supplier: {
      id: supplier.id,
      name: supplier.name,
      pricePerLitreCents: supplier.defaultPricePerLitreCents,
      payableCents: supplier.payableCents,
    },
    shopName: shop?.name ?? 'TastyMaziwa',
    submissions,
  };
}

// --- products & stock ----------------------------------------------------------------

export interface StockLevel {
  /** Null = fresh milk. */
  productId: string | null;
  name: string;
  unit: ProductUnit;
  salePriceCents: number | null;
  costPriceCents: number | null;
  reorderLevel: number | null;
  /** Thousandths of the unit: bought - sold - written off, all time. */
  onHand: number;
  /** Sold in the last 7 days, for "days of stock left". */
  sold7d: number;
  archived: boolean;
  low: boolean;
}

const stockMovement = sql<number>`coalesce(sum(case
  when ${ledgerEntries.kind} = 'delivery' then ${ledgerEntries.volumeMl}
  when ${ledgerEntries.kind} in ('sale', 'spoilage') then -${ledgerEntries.volumeMl}
  else 0 end), 0)`.mapWith(Number);

/** Stock on hand for milk and every product, from the ledger. */
export async function getStockLevels(
  db: DB,
  shopId: string,
  { includeArchived = false, today = todayBusinessDate() } = {},
): Promise<StockLevel[]> {
  const weekAgo = addDays(today, -6);
  const [rows, movement, shop] = await Promise.all([
    db
      .select()
      .from(products)
      .where(and(eq(products.shopId, shopId), includeArchived ? undefined : isNull(products.archivedAt)))
      .orderBy(products.name),
    db
      .select({
        productId: ledgerEntries.productId,
        onHand: stockMovement,
        sold7d: sql<number>`coalesce(sum(${ledgerEntries.volumeMl}) filter (where ${ledgerEntries.kind} = 'sale' and ${ledgerEntries.businessDate} >= ${weekAgo}), 0)`.mapWith(Number),
      })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.shopId, shopId))
      .groupBy(ledgerEntries.productId),
    getShop(db, shopId),
  ]);
  const of = (id: string | null) => movement.find((m) => m.productId === id) ?? { onHand: 0, sold7d: 0 };
  const milk = of(null);
  const levels: StockLevel[] = [
    {
      productId: null,
      name: 'Fresh milk',
      unit: 'litre',
      salePriceCents: shop?.salePricePerLitreCents ?? null,
      costPriceCents: null,
      reorderLevel: null,
      onHand: milk.onHand,
      sold7d: milk.sold7d,
      archived: false,
      low: isLowStock(milk.onHand, null),
    },
  ];
  for (const p of rows) {
    const m = of(p.id);
    levels.push({
      productId: p.id,
      name: p.name,
      unit: p.unit,
      salePriceCents: p.salePriceCents,
      costPriceCents: p.costPriceCents,
      reorderLevel: p.reorderLevel,
      onHand: m.onHand,
      sold7d: m.sold7d,
      archived: p.archivedAt != null,
      low: p.archivedAt == null && isLowStock(m.onHand, p.reorderLevel),
    });
  }
  return levels;
}

/** Stock on hand of one item (null = fresh milk), in thousandths of its unit. */
export async function getItemOnHand(db: DB, shopId: string, productId: string | null): Promise<number> {
  const [row] = await db
    .select({ onHand: stockMovement })
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.shopId, shopId),
        productId ? eq(ledgerEntries.productId, productId) : isNull(ledgerEntries.productId),
      ),
    );
  return row?.onHand ?? 0;
}

export async function getProduct(db: DB, shopId: string, productId: string) {
  const [product] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, productId), eq(products.shopId, shopId)));
  return product ?? null;
}

// --- shift closes ------------------------------------------------------------------

export async function listShiftCloses(
  db: DB,
  shopId: string,
  { status, limit = 30 }: { status?: 'submitted' | 'approved'; limit?: number } = {},
) {
  const closer = alias(users, 'closer');
  const reviewer = alias(users, 'reviewer');
  return db
    .select({
      id: shiftCloses.id,
      businessDate: shiftCloses.businessDate,
      periodStart: shiftCloses.periodStart,
      closedAt: shiftCloses.closedAt,
      closedByName: closer.name,
      openingFloatCents: shiftCloses.openingFloatCents,
      expectedCashCents: shiftCloses.expectedCashCents,
      countedCashCents: shiftCloses.countedCashCents,
      expectedMpesaCents: shiftCloses.expectedMpesaCents,
      countedMpesaCents: shiftCloses.countedMpesaCents,
      expectedMilkMl: shiftCloses.expectedMilkMl,
      countedMilkMl: shiftCloses.countedMilkMl,
      note: shiftCloses.note,
      status: shiftCloses.status,
      reviewedByName: reviewer.name,
      reviewedAt: shiftCloses.reviewedAt,
      reviewNote: shiftCloses.reviewNote,
      spoilageEntryId: shiftCloses.spoilageEntryId,
    })
    .from(shiftCloses)
    .innerJoin(closer, eq(closer.id, shiftCloses.closedBy))
    .leftJoin(reviewer, eq(reviewer.id, shiftCloses.reviewedBy))
    .where(and(eq(shiftCloses.shopId, shopId), status ? eq(shiftCloses.status, status) : undefined))
    .orderBy(desc(shiftCloses.closedAt))
    .limit(limit);
}

export type ShiftCloseItem = Awaited<ReturnType<typeof listShiftCloses>>[number];

// --- finance ----------------------------------------------------------------------

/** A statement for one period: balance brought forward, the lines, balance carried out. */
export async function getPeriodStatement(
  db: DB,
  shopId: string,
  party: { customerId: string } | { supplierId: string },
  from: BusinessDate,
  to: BusinessDate,
) {
  const kinds: LedgerListItem['kind'][] =
    'customerId' in party ? ['sale', 'customer_payment'] : ['delivery', 'supplier_payment'];
  const rows = await listEntries(db, shopId, { ...party, kinds, oldestFirst: true, limit: 100_000 });
  return statementForPeriod(withRunningBalance(rows, 'customerId' in party ? 'customer' : 'supplier'), from, to);
}

/** Spending per expense category in a period, with each category's monthly budget. */
export async function getExpenseBreakdown(db: DB, shopId: string, from: BusinessDate, to: BusinessDate) {
  const [spent, budgets] = await Promise.all([
    db
      .select({ category: ledgerEntries.expenseCategory, amountCents: sumAmount })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.shopId, shopId),
          eq(ledgerEntries.kind, 'expense'),
          gte(ledgerEntries.businessDate, from),
          lte(ledgerEntries.businessDate, to),
        ),
      )
      .groupBy(ledgerEntries.expenseCategory),
    db.select().from(expenseBudgets).where(eq(expenseBudgets.shopId, shopId)),
  ]);
  return {
    spent: new Map(spent.map((s) => [s.category ?? 'other', s.amountCents])),
    budgets: new Map(budgets.map((b) => [b.category, b.monthlyCents])),
  };
}

// --- staff & payroll ------------------------------------------------------------------

/** The team with this month's days worked, today's attendance and advances still owed. */
export async function listEmployees(db: DB, shopId: string, today = todayBusinessDate()) {
  const from = `${today.slice(0, 7)}-01`;
  const [staff, days, advances] = await Promise.all([
    db.select().from(employees).where(eq(employees.shopId, shopId)).orderBy(desc(employees.active), employees.name),
    db
      .select({
        employeeId: attendance.employeeId,
        days: sql<number>`count(*)`.mapWith(Number),
        today: sql<boolean>`bool_or(${attendance.businessDate} = ${today})`,
      })
      .from(attendance)
      .where(and(eq(attendance.shopId, shopId), gte(attendance.businessDate, from), lte(attendance.businessDate, today)))
      .groupBy(attendance.employeeId),
    db
      .select({
        employeeId: employeeAdvances.employeeId,
        cents: sql<number>`coalesce(sum(${employeeAdvances.amountCents}), 0)`.mapWith(Number),
      })
      .from(employeeAdvances)
      .where(and(eq(employeeAdvances.shopId, shopId), isNull(employeeAdvances.settledInRunId)))
      .groupBy(employeeAdvances.employeeId),
  ]);
  const daysOf = new Map(days.map((d) => [d.employeeId, d]));
  const advOf = new Map(advances.map((a) => [a.employeeId, a.cents]));
  return staff.map((e) => ({
    ...e,
    daysThisMonth: daysOf.get(e.id)?.days ?? 0,
    presentToday: daysOf.get(e.id)?.today ?? false,
    advancesCents: advOf.get(e.id) ?? 0,
  }));
}

export type EmployeeItem = Awaited<ReturnType<typeof listEmployees>>[number];

export async function listPayrollRuns(db: DB, shopId: string) {
  const [runs, lines] = await Promise.all([
    db
      .select({
        id: payrollRuns.id,
        month: payrollRuns.month,
        paymentMethod: payrollRuns.paymentMethod,
        grossCents: payrollRuns.grossCents,
        advancesCents: payrollRuns.advancesCents,
        netCents: payrollRuns.netCents,
        statutoryDueCents: payrollRuns.statutoryDueCents,
        remittedAt: payrollRuns.remittedAt,
        postedAt: payrollRuns.postedAt,
        postedByName: users.name,
      })
      .from(payrollRuns)
      .leftJoin(users, eq(users.id, payrollRuns.postedBy))
      .where(eq(payrollRuns.shopId, shopId))
      .orderBy(desc(payrollRuns.month))
      .limit(24),
    db
      .select({
        runId: payrollLines.runId,
        name: employees.name,
        daysWorked: payrollLines.daysWorked,
        grossCents: payrollLines.grossCents,
        advancesCents: payrollLines.advancesCents,
        netCents: payrollLines.netCents,
        nssfCents: payrollLines.nssfCents,
        shifCents: payrollLines.shifCents,
        housingLevyCents: payrollLines.housingLevyCents,
        payeCents: payrollLines.payeCents,
      })
      .from(payrollLines)
      .innerJoin(employees, eq(employees.id, payrollLines.employeeId))
      .where(eq(payrollLines.shopId, shopId))
      .orderBy(employees.name),
  ]);
  return runs.map((r) => ({ ...r, lines: lines.filter((l) => l.runId === r.id) }));
}

/**
 * Payslips for one payroll run (optionally one person): everything a
 * payslip shows, including the employer's own contributions.
 */
export async function getPayslips(db: DB, shopId: string, runId: string, employeeId?: string) {
  const [run] = await db
    .select()
    .from(payrollRuns)
    .where(and(eq(payrollRuns.id, runId), eq(payrollRuns.shopId, shopId)));
  if (!run) return null;
  const lines = await db
    .select({
      employeeId: employees.id,
      name: employees.name,
      phone: employees.phone,
      payType: employees.payType,
      rateCents: employees.rateCents,
      kraPin: employees.kraPin,
      nssfNumber: employees.nssfNumber,
      shaNumber: employees.shaNumber,
      daysWorked: payrollLines.daysWorked,
      grossCents: payrollLines.grossCents,
      nssfCents: payrollLines.nssfCents,
      shifCents: payrollLines.shifCents,
      housingLevyCents: payrollLines.housingLevyCents,
      taxableCents: payrollLines.taxableCents,
      payeCents: payrollLines.payeCents,
      advancesCents: payrollLines.advancesCents,
      netCents: payrollLines.netCents,
      employerNssfCents: payrollLines.employerNssfCents,
      employerHousingLevyCents: payrollLines.employerHousingLevyCents,
      employerNitaCents: payrollLines.employerNitaCents,
    })
    .from(payrollLines)
    .innerJoin(employees, and(eq(employees.id, payrollLines.employeeId), eq(employees.shopId, payrollLines.shopId)))
    .where(
      and(
        eq(payrollLines.shopId, shopId),
        eq(payrollLines.runId, run.id),
        employeeId ? eq(payrollLines.employeeId, employeeId) : undefined,
      ),
    )
    .orderBy(employees.name);
  return { run, lines };
}

export type Payslip = NonNullable<Awaited<ReturnType<typeof getPayslips>>>['lines'][number];

/**
 * A calendar year of posted pay for staff with statutory deductions: one
 * entry per person, with their lines by month (for the P9A card).
 */
export async function getP9Data(db: DB, shopId: string, year: number) {
  const rows = await db
    .select({
      employeeId: employees.id,
      name: employees.name,
      kraPin: employees.kraPin,
      month: payrollRuns.month,
      grossCents: payrollLines.grossCents,
      nssfCents: payrollLines.nssfCents,
      shifCents: payrollLines.shifCents,
      housingLevyCents: payrollLines.housingLevyCents,
      taxableCents: payrollLines.taxableCents,
      payeCents: payrollLines.payeCents,
    })
    .from(payrollLines)
    .innerJoin(payrollRuns, and(eq(payrollRuns.id, payrollLines.runId), eq(payrollRuns.shopId, payrollLines.shopId)))
    .innerJoin(employees, and(eq(employees.id, payrollLines.employeeId), eq(employees.shopId, payrollLines.shopId)))
    .where(
      and(
        eq(payrollLines.shopId, shopId),
        sql`${payrollRuns.month} like ${`${year}-%`}`,
        // Only people who had statutory deductions that year need a P9.
        sql`${payrollLines.nssfCents} + ${payrollLines.shifCents} + ${payrollLines.housingLevyCents} + ${payrollLines.payeCents} > 0`,
      ),
    )
    .orderBy(employees.name, payrollRuns.month);
  return [...Map.groupBy(rows, (r) => r.employeeId).values()].map((lines) => ({
    employeeId: lines[0].employeeId,
    name: lines[0].name,
    kraPin: lines[0].kraPin,
    months: new Map(lines.map((l) => [l.month, l])),
  }));
}

// --- shop ---------------------------------------------------------------------

export async function getShop(db: DB, shopId: string) {
  const [shop] = await db.select().from(shops).where(eq(shops.id, shopId));
  return shop ?? null;
}
