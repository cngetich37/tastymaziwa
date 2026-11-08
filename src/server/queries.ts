/**
 * Read models for the UI. Aggregation happens in SQL; derived figures come
 * from the pure functions in src/lib/calc so they are unit-tested.
 *
 * Every query takes a `shopId` and filters by it: tenants never see each
 * other's data. Joins stay within a shop because of the composite FKs.
 */
import { and, desc, eq, gte, isNull, lte, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { DB } from '@/db/client';
import { customers, ledgerEntries, shops, subscriptions, suppliers, users } from '@/db/schema';
import { allocatePayments, type AllocatedCreditSale } from '@/lib/calc/allocation';
import {
  customerBalanceCents,
  dailySeries,
  summarize,
  supplierPayableCents,
  type DailyPoint,
  type LedgerRow,
  type Summary,
} from '@/lib/calc/summary';
import { daysBetween, lastNDates, todayBusinessDate, type BusinessDate } from '@/lib/dates';

const sumAmount = sql<number>`coalesce(sum(${ledgerEntries.amountCents}), 0)`.mapWith(Number);
const sumVolume = sql<number>`coalesce(sum(${ledgerEntries.volumeMl}), 0)`.mapWith(Number);

/** Ledger totals grouped by kind and payment method, plus any extra group-by columns. */
async function aggregate(db: DB, shopId: string, where?: SQL): Promise<LedgerRow[]> {
  return db
    .select({
      kind: ledgerEntries.kind,
      paymentMethod: ledgerEntries.paymentMethod,
      amountCents: sumAmount,
      volumeMl: sumVolume,
    })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.shopId, shopId), where))
    .groupBy(ledgerEntries.kind, ledgerEntries.paymentMethod);
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
      .groupBy(ledgerEntries.businessDate, ledgerEntries.kind, ledgerEntries.paymentMethod),
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
  customerName: string | null;
  supplierName: string | null;
  category: string | null;
  note: string | null;
  createdByName: string | null;
  reversesId: string | null;
  reversedById: string | null;
}

export async function listEntries(
  db: DB,
  shopId: string,
  { limit = 50, offset = 0 }: { limit?: number; offset?: number } = {},
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
    .leftJoin(users, eq(users.id, ledgerEntries.createdBy))
    .leftJoin(reversal, eq(reversal.reversesId, ledgerEntries.id))
    .where(eq(ledgerEntries.shopId, shopId))
    .orderBy(desc(ledgerEntries.occurredAt), desc(ledgerEntries.createdAt))
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
export async function getLastSalePriceCents(db: DB, shopId: string, fallbackCents = 7000): Promise<number> {
  const [row] = await db
    .select({ price: ledgerEntries.unitPriceCents })
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.shopId, shopId),
        eq(ledgerEntries.kind, 'sale'),
        isNull(ledgerEntries.reversesId),
        isNull(ledgerEntries.subscriptionId),
      ),
    )
    .orderBy(desc(ledgerEntries.occurredAt))
    .limit(1);
  return row?.price ?? fallbackCents;
}

// --- shop ---------------------------------------------------------------------

export async function getShop(db: DB, shopId: string) {
  const [shop] = await db.select().from(shops).where(eq(shops.id, shopId));
  return shop ?? null;
}
