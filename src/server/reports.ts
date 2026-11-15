/**
 * Reports for the owner: each one is a few SQL aggregates over a date range,
 * turned into plain tables the page renders and the browser exports as CSV.
 * Every query filters by `shopId`, like everything in queries.ts.
 */
import { and, asc, eq, gte, isNull, lte, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { DB } from '@/db/client';
import { deliverySubmissions, ledgerEntries, suppliers, users } from '@/db/schema';
import {
  AGE_BUCKET_LABELS,
  AGE_BUCKETS,
  ageingByCustomer,
  marginPerLitreCents,
  perLitreCents,
  type DateRange,
  type ReportColumn,
  type ReportTable,
} from '@/lib/calc/reports';
import { summarize, type LedgerRow } from '@/lib/calc/summary';
import { formatTime, type BusinessDate } from '@/lib/dates';
import type { ReportType } from '@/lib/validation';
import { getOutstandingCredit, listCustomers, listDeliverySubmissions, listSuppliers } from './queries';

export interface ReportStat {
  label: string;
  value: number | null;
  type: 'kes' | 'litres' | 'int';
  tone?: 'positive' | 'negative' | 'warning';
}

export interface Report {
  type: ReportType;
  title: string;
  description: string;
  /** False for reports that are "as of today" (balances), not over the range. */
  usesRange: boolean;
  stats: ReportStat[];
  tables: ReportTable[];
}

export const REPORT_INFO: Record<ReportType, { title: string; description: string }> = {
  profit: { title: 'Profit & loss', description: 'Sales, cost of milk, expenses and profit, per day.' },
  sales: { title: 'Sales', description: 'Litres and money taken per day, by how customers paid.' },
  deliveries: { title: 'Deliveries', description: 'Milk received from each supplier, and what it cost.' },
  approvals: { title: 'Delivery approvals', description: 'Every delivery a supplier recorded, and who approved or rejected it.' },
  debtors: { title: 'Debtors (deni)', description: 'Who owes the shop, and how late each debt is. As of today.' },
  suppliers: { title: 'Supplier balances', description: 'What the shop owes each milkman. As of today, with this period’s activity.' },
  expenses: { title: 'Expenses', description: 'Operating costs by category.' },
  staff: { title: 'Team activity', description: 'What each person recorded and approved.' },
};

const sumAmount = sql<number>`coalesce(sum(${ledgerEntries.amountCents}), 0)`.mapWith(Number);
const sumVolume = sql<number>`coalesce(sum(${ledgerEntries.volumeMl}), 0)`.mapWith(Number);
/** Entries net of reversals: a reversed entry and its reversal cancel out. */
const countOriginals = sql<number>`count(*) filter (where ${ledgerEntries.reversesId} is null) - count(*) filter (where ${ledgerEntries.reversesId} is not null)`.mapWith(Number);

const inRange = (range: DateRange): SQL =>
  and(gte(ledgerEntries.businessDate, range.from), lte(ledgerEntries.businessDate, range.to))!;

const col = (key: string, label: string, type: ReportColumn['type'] = 'text'): ReportColumn => ({ key, label, type });

async function byDay(db: DB, shopId: string, range: DateRange) {
  return db
    .select({
      businessDate: ledgerEntries.businessDate,
      kind: ledgerEntries.kind,
      paymentMethod: ledgerEntries.paymentMethod,
      productId: ledgerEntries.productId,
      amountCents: sumAmount,
      volumeMl: sumVolume,
    })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.shopId, shopId), inRange(range)))
    .groupBy(ledgerEntries.businessDate, ledgerEntries.kind, ledgerEntries.paymentMethod, ledgerEntries.productId)
    .orderBy(asc(ledgerEntries.businessDate));
}

function perDaySummaries(rows: (LedgerRow & { businessDate: BusinessDate })[]) {
  return [...Map.groupBy(rows, (r) => r.businessDate)].map(([date, dayRows]) => ({ date, ...summarize(dayRows) }));
}

// --- the reports -------------------------------------------------------------------

async function profitReport(db: DB, shopId: string, range: DateRange): Promise<Report> {
  const [rows, expenseRows] = await Promise.all([
    byDay(db, shopId, range),
    expensesByCategory(db, shopId, range),
  ]);
  const total = summarize(rows);
  const days = perDaySummaries(rows);
  return {
    type: 'profit',
    ...REPORT_INFO.profit,
    usesRange: true,
    stats: [
      { label: 'Sales', value: total.salesCents, type: 'kes' },
      { label: 'Cost of milk', value: total.deliveryCostCents, type: 'kes' },
      { label: 'Expenses', value: total.expensesCents, type: 'kes' },
      { label: 'Net profit', value: total.netProfitCents, type: 'kes', tone: total.netProfitCents < 0 ? 'negative' : 'positive' },
      { label: 'Gross profit', value: total.grossProfitCents, type: 'kes' },
      { label: 'Margin per litre', value: marginPerLitreCents(total), type: 'kes' },
      { label: 'Litres sold', value: total.salesMl, type: 'litres' },
      { label: 'Litres spoiled', value: total.spoiledMl, type: 'litres', tone: total.spoiledMl ? 'warning' : undefined },
    ],
    tables: [
      {
        title: 'Per day',
        columns: [
          col('date', 'Date', 'date'),
          col('soldMl', 'Sold', 'litres'),
          col('sales', 'Sales', 'kes'),
          col('cost', 'Cost of milk', 'kes'),
          col('gross', 'Gross profit', 'kes'),
          col('expenses', 'Expenses', 'kes'),
          col('net', 'Net profit', 'kes'),
        ],
        rows: days.map((d) => ({
          date: d.date,
          soldMl: d.salesMl,
          sales: d.salesCents,
          cost: d.deliveryCostCents,
          gross: d.grossProfitCents,
          expenses: d.expensesCents,
          net: d.netProfitCents,
        })),
        totals: {
          date: 'Total',
          soldMl: total.salesMl,
          sales: total.salesCents,
          cost: total.deliveryCostCents,
          gross: total.grossProfitCents,
          expenses: total.expensesCents,
          net: total.netProfitCents,
        },
        emptyText: 'Nothing was recorded in this period.',
      },
      expenseTable(expenseRows),
    ],
  };
}

async function salesReport(db: DB, shopId: string, range: DateRange): Promise<Report> {
  const rows = await byDay(db, shopId, range);
  const total = summarize(rows);
  const days = perDaySummaries(rows).filter((d) => d.salesMl || d.salesCents);
  return {
    type: 'sales',
    ...REPORT_INFO.sales,
    usesRange: true,
    stats: [
      { label: 'Litres sold', value: total.salesMl, type: 'litres' },
      { label: 'Sales', value: total.salesCents, type: 'kes' },
      { label: 'Average price / L', value: perLitreCents(total.salesCents, total.salesMl), type: 'kes' },
      { label: 'On credit', value: total.creditSalesCents, type: 'kes', tone: total.creditSalesCents ? 'warning' : undefined },
    ],
    tables: [
      {
        title: 'Per day',
        columns: [
          col('date', 'Date', 'date'),
          col('soldMl', 'Litres', 'litres'),
          col('cash', 'Cash', 'kes'),
          col('mpesa', 'M-Pesa', 'kes'),
          col('credit', 'Credit', 'kes'),
          col('total', 'Total', 'kes'),
          col('collected', 'Debt collected', 'kes'),
        ],
        rows: days.map((d) => ({
          date: d.date,
          soldMl: d.salesMl,
          cash: d.cashSalesCents,
          mpesa: d.mpesaSalesCents,
          credit: d.creditSalesCents,
          total: d.salesCents,
          collected: d.customerPaymentsCents,
        })),
        totals: {
          date: 'Total',
          soldMl: total.salesMl,
          cash: total.cashSalesCents,
          mpesa: total.mpesaSalesCents,
          credit: total.creditSalesCents,
          total: total.salesCents,
          collected: total.customerPaymentsCents,
        },
        emptyText: 'No sales in this period.',
      },
    ],
  };
}

async function deliveriesReport(db: DB, shopId: string, range: DateRange): Promise<Report> {
  const [rows, submissions] = await Promise.all([
    db
      .select({
        supplierId: ledgerEntries.supplierId,
        name: suppliers.name,
        deliveries: countOriginals,
        // Litres of milk; other stock bought from them counts in cost only.
        volumeMl: sql<number>`coalesce(sum(${ledgerEntries.volumeMl}) filter (where ${ledgerEntries.productId} is null), 0)`.mapWith(Number),
        amountCents: sumAmount,
      })
      .from(ledgerEntries)
      .innerJoin(suppliers, eq(suppliers.id, ledgerEntries.supplierId))
      .where(and(eq(ledgerEntries.shopId, shopId), eq(ledgerEntries.kind, 'delivery'), inRange(range)))
      .groupBy(ledgerEntries.supplierId, suppliers.name)
      .orderBy(suppliers.name),
    db
      .select({
        supplierId: deliverySubmissions.supplierId,
        status: deliverySubmissions.status,
        count: sql<number>`count(*)`.mapWith(Number),
        volumeMl: sql<number>`coalesce(sum(${deliverySubmissions.volumeMl}), 0)`.mapWith(Number),
      })
      .from(deliverySubmissions)
      .where(
        and(
          eq(deliverySubmissions.shopId, shopId),
          gte(deliverySubmissions.businessDate, range.from),
          lte(deliverySubmissions.businessDate, range.to),
        ),
      )
      .groupBy(deliverySubmissions.supplierId, deliverySubmissions.status),
  ]);
  const subsOf = (supplierId: string | null, status: string) =>
    submissions.find((s) => s.supplierId === supplierId && s.status === status)?.count ?? 0;
  const volume = rows.reduce((n, r) => n + r.volumeMl, 0);
  const cost = rows.reduce((n, r) => n + r.amountCents, 0);
  const pending = submissions.filter((s) => s.status === 'pending');
  return {
    type: 'deliveries',
    ...REPORT_INFO.deliveries,
    usesRange: true,
    stats: [
      { label: 'Milk received', value: volume, type: 'litres' },
      { label: 'Cost of milk', value: cost, type: 'kes' },
      { label: 'Average cost / L', value: perLitreCents(cost, volume), type: 'kes' },
      {
        label: 'Waiting for approval',
        value: pending.reduce((n, s) => n + s.volumeMl, 0),
        type: 'litres',
        tone: pending.length ? 'warning' : undefined,
      },
    ],
    tables: [
      {
        title: 'By supplier',
        description: 'Approved deliveries only: rejected and pending ones are not counted as received.',
        columns: [
          col('name', 'Supplier'),
          col('deliveries', 'Deliveries', 'int'),
          col('volumeMl', 'Litres', 'litres'),
          col('amount', 'Cost', 'kes'),
          col('avg', 'Avg / L', 'kes'),
          col('rejected', 'Rejected', 'int'),
          col('pending', 'Pending', 'int'),
        ],
        rows: rows.map((r) => ({
          name: r.name,
          deliveries: r.deliveries,
          volumeMl: r.volumeMl,
          amount: r.amountCents,
          avg: perLitreCents(r.amountCents, r.volumeMl),
          rejected: subsOf(r.supplierId, 'rejected'),
          pending: subsOf(r.supplierId, 'pending'),
        })),
        totals: {
          name: 'Total',
          deliveries: rows.reduce((n, r) => n + r.deliveries, 0),
          volumeMl: volume,
          amount: cost,
          avg: perLitreCents(cost, volume),
          rejected: submissions.filter((s) => s.status === 'rejected').reduce((n, s) => n + s.count, 0),
          pending: pending.reduce((n, s) => n + s.count, 0),
        },
        emptyText: 'No milk received in this period.',
      },
    ],
  };
}

async function approvalsReport(db: DB, shopId: string, range: DateRange): Promise<Report> {
  const rows = await listDeliverySubmissions(db, shopId, { from: range.from, to: range.to, limit: 2000 });
  const count = (status: string) => rows.filter((r) => r.status === status).length;
  return {
    type: 'approvals',
    ...REPORT_INFO.approvals,
    usesRange: true,
    stats: [
      { label: 'Recorded by suppliers', value: rows.length, type: 'int' },
      { label: 'Approved', value: count('approved'), type: 'int', tone: 'positive' },
      { label: 'Rejected', value: count('rejected'), type: 'int', tone: count('rejected') ? 'negative' : undefined },
      { label: 'Still waiting', value: count('pending'), type: 'int', tone: count('pending') ? 'warning' : undefined },
    ],
    tables: [
      {
        title: 'Every delivery',
        columns: [
          col('date', 'Date', 'date'),
          col('time', 'Time'),
          col('supplier', 'Supplier'),
          col('volumeMl', 'Litres', 'litres'),
          col('status', 'Status'),
          col('reviewedBy', 'Decided by'),
          col('reason', 'Reason / note'),
        ],
        rows: rows.map((r) => ({
          date: r.businessDate,
          time: formatTime(new Date(r.submittedAt)),
          supplier: r.supplierName,
          volumeMl: r.volumeMl,
          status: r.status,
          reviewedBy: r.reviewedByName,
          reason: r.reviewNote ?? r.note,
        })),
        emptyText: 'No supplier recorded a delivery in this period.',
      },
    ],
  };
}

async function debtorsReport(db: DB, shopId: string): Promise<Report> {
  const [outstanding, customers] = await Promise.all([getOutstandingCredit(db, shopId), listCustomers(db, shopId)]);
  const ageing = ageingByCustomer(outstanding);
  const phone = new Map(customers.map((c) => [c.id, c.phone]));
  const bucketTotal = (b: (typeof AGE_BUCKETS)[number]) => ageing.reduce((n, r) => n + r[b], 0);
  const total = ageing.reduce((n, r) => n + r.totalCents, 0);
  return {
    type: 'debtors',
    ...REPORT_INFO.debtors,
    usesRange: false,
    stats: [
      { label: 'Customers owe', value: total, type: 'kes' },
      { label: 'Customers owing', value: ageing.length, type: 'int' },
      { label: AGE_BUCKET_LABELS.d8_30, value: bucketTotal('d8_30'), type: 'kes', tone: bucketTotal('d8_30') ? 'warning' : undefined },
      { label: AGE_BUCKET_LABELS.d30_plus, value: bucketTotal('d30_plus'), type: 'kes', tone: bucketTotal('d30_plus') ? 'negative' : undefined },
    ],
    tables: [
      {
        title: 'Ageing by customer',
        description: 'Payments are applied to the oldest purchases first.',
        columns: [
          col('name', 'Customer'),
          col('phone', 'Phone'),
          col('oldest', 'Oldest unpaid', 'date'),
          ...AGE_BUCKETS.map((b) => col(b, AGE_BUCKET_LABELS[b], 'kes')),
          col('total', 'Total owed', 'kes'),
        ],
        rows: ageing.map((r) => ({
          name: r.customerName,
          phone: phone.get(r.customerId) ?? null,
          oldest: r.oldestDate,
          ...Object.fromEntries(AGE_BUCKETS.map((b) => [b, r[b]])),
          total: r.totalCents,
        })),
        totals: {
          name: 'Total',
          ...Object.fromEntries(AGE_BUCKETS.map((b) => [b, bucketTotal(b)])),
          total,
        },
        emptyText: 'Nobody owes the shop anything. 👍',
      },
    ],
  };
}

async function suppliersReport(db: DB, shopId: string, range: DateRange): Promise<Report> {
  const [balances, activity] = await Promise.all([
    listSuppliers(db, shopId),
    db
      .select({
        supplierId: ledgerEntries.supplierId,
        kind: ledgerEntries.kind,
        amountCents: sumAmount,
        volumeMl: sql<number>`coalesce(sum(${ledgerEntries.volumeMl}) filter (where ${ledgerEntries.productId} is null), 0)`.mapWith(Number),
      })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.shopId, shopId),
          sql`${ledgerEntries.kind} in ('delivery', 'supplier_payment')`,
          inRange(range),
        ),
      )
      .groupBy(ledgerEntries.supplierId, ledgerEntries.kind),
  ]);
  const of = (supplierId: string, kind: string) => activity.find((a) => a.supplierId === supplierId && a.kind === kind);
  const owed = balances.reduce((n, s) => n + s.payableCents, 0);
  const rows = balances.map((s) => ({
    name: s.name,
    phone: s.phone,
    price: s.defaultPricePerLitreCents,
    deliveredMl: of(s.id, 'delivery')?.volumeMl ?? 0,
    bought: of(s.id, 'delivery')?.amountCents ?? 0,
    paid: of(s.id, 'supplier_payment')?.amountCents ?? 0,
    owed: s.payableCents,
  }));
  return {
    type: 'suppliers',
    ...REPORT_INFO.suppliers,
    usesRange: true,
    stats: [
      { label: 'You owe suppliers', value: owed, type: 'kes', tone: owed > 0 ? 'warning' : undefined },
      { label: 'Bought this period', value: rows.reduce((n, r) => n + r.bought, 0), type: 'kes' },
      { label: 'Paid this period', value: rows.reduce((n, r) => n + r.paid, 0), type: 'kes' },
      { label: 'Suppliers', value: rows.length, type: 'int' },
    ],
    tables: [
      {
        title: 'Balances',
        columns: [
          col('name', 'Supplier'),
          col('phone', 'Phone'),
          col('price', 'Agreed price / L', 'kes'),
          col('deliveredMl', 'Received', 'litres'),
          col('bought', 'Bought', 'kes'),
          col('paid', 'Paid', 'kes'),
          col('owed', 'Owed now', 'kes'),
        ],
        rows,
        totals: {
          name: 'Total',
          deliveredMl: rows.reduce((n, r) => n + r.deliveredMl, 0),
          bought: rows.reduce((n, r) => n + r.bought, 0),
          paid: rows.reduce((n, r) => n + r.paid, 0),
          owed,
        },
        emptyText: 'No suppliers yet.',
      },
    ],
  };
}

function expensesByCategory(db: DB, shopId: string, range: DateRange) {
  return db
    .select({ category: ledgerEntries.expenseCategory, count: countOriginals, amountCents: sumAmount })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.shopId, shopId), eq(ledgerEntries.kind, 'expense'), inRange(range)))
    .groupBy(ledgerEntries.expenseCategory)
    .orderBy(sql`${sumAmount} desc`);
}

const categoryLabel = (c: string | null) => (c ?? 'other').replace(/_/g, ' ').replace(/^\w/, (x) => x.toUpperCase());

function expenseTable(rows: Awaited<ReturnType<typeof expensesByCategory>>): ReportTable {
  return {
    title: 'Expenses by category',
    columns: [col('category', 'Category'), col('count', 'Entries', 'int'), col('amount', 'Amount', 'kes')],
    rows: rows.filter((r) => r.amountCents !== 0).map((r) => ({ category: categoryLabel(r.category), count: r.count, amount: r.amountCents })),
    totals: { category: 'Total', count: rows.reduce((n, r) => n + r.count, 0), amount: rows.reduce((n, r) => n + r.amountCents, 0) },
    emptyText: 'No expenses in this period.',
  };
}

async function expensesReport(db: DB, shopId: string, range: DateRange): Promise<Report> {
  const rows = await expensesByCategory(db, shopId, range);
  const total = rows.reduce((n, r) => n + r.amountCents, 0);
  const top = rows.find((r) => r.amountCents > 0);
  return {
    type: 'expenses',
    ...REPORT_INFO.expenses,
    usesRange: true,
    stats: [
      { label: 'Total expenses', value: total, type: 'kes' },
      { label: top ? `Biggest: ${categoryLabel(top.category)}` : 'Biggest category', value: top?.amountCents ?? 0, type: 'kes' },
    ],
    tables: [expenseTable(rows)],
  };
}

async function staffReport(db: DB, shopId: string, range: DateRange): Promise<Report> {
  const reversal = alias(ledgerEntries, 'reversal');
  const [entries, reviews, team] = await Promise.all([
    // Each person's own entries (reversals aside). Litres and value count only
    // entries still standing; `reversed` counts theirs that were later cancelled.
    db
      .select({
        userId: ledgerEntries.createdBy,
        kind: ledgerEntries.kind,
        count: sql<number>`count(*) filter (where ${reversal.id} is null)`.mapWith(Number),
        reversed: sql<number>`count(${reversal.id})`.mapWith(Number),
        volumeMl: sql<number>`coalesce(sum(${ledgerEntries.volumeMl}) filter (where ${reversal.id} is null and ${ledgerEntries.productId} is null), 0)`.mapWith(Number),
        amountCents: sql<number>`coalesce(sum(${ledgerEntries.amountCents}) filter (where ${reversal.id} is null), 0)`.mapWith(Number),
      })
      .from(ledgerEntries)
      .leftJoin(reversal, eq(reversal.reversesId, ledgerEntries.id))
      .where(and(eq(ledgerEntries.shopId, shopId), isNull(ledgerEntries.reversesId), inRange(range)))
      .groupBy(ledgerEntries.createdBy, ledgerEntries.kind),
    db
      .select({
        userId: deliverySubmissions.reviewedBy,
        status: deliverySubmissions.status,
        count: sql<number>`count(*)`.mapWith(Number),
      })
      .from(deliverySubmissions)
      .where(
        and(
          eq(deliverySubmissions.shopId, shopId),
          gte(deliverySubmissions.businessDate, range.from),
          lte(deliverySubmissions.businessDate, range.to),
        ),
      )
      .groupBy(deliverySubmissions.reviewedBy, deliverySubmissions.status),
    db
      .select({ id: users.id, name: users.name, role: users.role })
      .from(users)
      .where(and(eq(users.shopId, shopId), sql`${users.role} <> 'supplier'`))
      .orderBy(users.name),
  ]);
  const of = (userId: string | null, kind: string) => entries.find((e) => e.userId === userId && e.kind === kind);
  const reviewed = (userId: string | null, status: string) =>
    reviews.find((r) => r.userId === userId && r.status === status)?.count ?? 0;
  const rows = team.map((u) => ({
    name: u.name,
    role: u.role === 'owner' ? 'Owner' : 'Seller',
    sales: of(u.id, 'sale')?.count ?? 0,
    soldMl: of(u.id, 'sale')?.volumeMl ?? 0,
    salesValue: of(u.id, 'sale')?.amountCents ?? 0,
    deliveries: of(u.id, 'delivery')?.count ?? 0,
    approved: reviewed(u.id, 'approved'),
    rejected: reviewed(u.id, 'rejected'),
    reversed: entries.filter((e) => e.userId === u.id).reduce((n, e) => n + e.reversed, 0),
  }));
  const system = of(null, 'sale');
  if (system?.count) {
    rows.push({ name: 'Subscriptions (automatic)', role: 'System', sales: system.count, soldMl: system.volumeMl, salesValue: system.amountCents, deliveries: 0, approved: 0, rejected: 0, reversed: system.reversed });
  }
  return {
    type: 'staff',
    ...REPORT_INFO.staff,
    usesRange: true,
    stats: [
      { label: 'Sales recorded', value: rows.reduce((n, r) => n + r.sales, 0), type: 'int' },
      { label: 'Deliveries approved', value: rows.reduce((n, r) => n + r.approved, 0), type: 'int' },
      { label: 'Deliveries rejected', value: rows.reduce((n, r) => n + r.rejected, 0), type: 'int' },
    ],
    tables: [
      {
        title: 'By person',
        description:
          '"Deliveries" are ones typed in directly; approvals are deliveries suppliers recorded that they checked. "Corrected" counts their entries the owner later reversed.',
        columns: [
          col('name', 'Name'),
          col('role', 'Role'),
          col('sales', 'Sales', 'int'),
          col('soldMl', 'Litres sold', 'litres'),
          col('salesValue', 'Sales value', 'kes'),
          col('deliveries', 'Deliveries', 'int'),
          col('approved', 'Approved', 'int'),
          col('rejected', 'Rejected', 'int'),
          col('reversed', 'Corrected', 'int'),
        ],
        rows,
        emptyText: 'No team members.',
      },
    ],
  };
}

export function getReport(
  db: DB,
  shopId: string,
  type: ReportType,
  range: DateRange,
): Promise<Report> {
  switch (type) {
    case 'profit':
      return profitReport(db, shopId, range);
    case 'sales':
      return salesReport(db, shopId, range);
    case 'deliveries':
      return deliveriesReport(db, shopId, range);
    case 'approvals':
      return approvalsReport(db, shopId, range);
    case 'debtors':
      return debtorsReport(db, shopId);
    case 'suppliers':
      return suppliersReport(db, shopId, range);
    case 'expenses':
      return expensesReport(db, shopId, range);
    case 'staff':
      return staffReport(db, shopId, range);
  }
}
