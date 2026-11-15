/**
 * "Keep what I added": when a demo visitor signs up, their new real shop can
 * start with the setup they built while trying the demo, but never the
 * sample data or any trading (the ledger is append-only, so fake sales would
 * stay in their books for good).
 *
 * "What they added" is exactly what the demo's audit log names: the sample
 * generator writes no per-item audit rows, while every customer, supplier,
 * product, staff member, subscription, budget or price the visitor creates
 * or edits does. Archived and inactive items, logins and anything in the
 * ledger are left behind.
 */
import { and, eq, inArray, isNotNull, isNull, ne } from 'drizzle-orm';
import type { DB, Tx } from '@/db/client';
import { todayBusinessDate } from '@/lib/dates';
import { auditLog, customers, employees, expenseBudgets, products, shops, subscriptions, suppliers } from '@/db/schema';

export interface DemoKeepSummary {
  customers: number;
  suppliers: number;
  products: number;
  staff: number;
  subscriptions: number;
  budgets: number;
  salePrice: boolean;
}

const TRACKED = [
  'customer.create',
  'customer.update',
  'supplier.create',
  'supplier.update',
  'product.create',
  'product.update',
  'employee.create',
  'employee.update',
  'subscription.create',
  'budgets.set',
  'shop.sale_price',
];

/** Ids of the items the visitor created or changed, read from the demo's audit log. */
async function touched(q: DB | Tx, shopId: string) {
  const rows = await q
    .select({ action: auditLog.action, entityId: auditLog.entityId })
    .from(auditLog)
    .where(and(eq(auditLog.shopId, shopId), isNotNull(auditLog.userId), inArray(auditLog.action, TRACKED)));
  const ids = (prefix: string) =>
    [...new Set(rows.filter((r) => r.action.startsWith(`${prefix}.`) && r.entityId).map((r) => r.entityId!))];
  return {
    customerIds: ids('customer'),
    supplierIds: ids('supplier'),
    productIds: ids('product'),
    employeeIds: ids('employee'),
    subscriptionIds: ids('subscription'),
    budgets: rows.some((r) => r.action === 'budgets.set'),
    salePrice: rows.some((r) => r.action === 'shop.sale_price'),
  };
}

const none = ['00000000-0000-0000-0000-000000000000'];
const anyOf = (ids: string[]) => (ids.length ? ids : none);

/** Everything that would be kept, as rows (shared by the summary and the copy). */
async function selectKept(q: DB | Tx, shopId: string) {
  const t = await touched(q, shopId);
  const subs = await q
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.shopId, shopId), inArray(subscriptions.id, anyOf(t.subscriptionIds)), ne(subscriptions.status, 'cancelled')));
  // A subscription brings its customer along, even a sample one.
  const customerIds = [...new Set([...t.customerIds, ...subs.map((s) => s.customerId)])];
  const [keptCustomers, keptSuppliers, keptProducts, keptStaff, budgets, [shop]] = await Promise.all([
    q.select().from(customers).where(and(eq(customers.shopId, shopId), inArray(customers.id, anyOf(customerIds)), isNull(customers.archivedAt))),
    q.select().from(suppliers).where(and(eq(suppliers.shopId, shopId), inArray(suppliers.id, anyOf(t.supplierIds)), isNull(suppliers.archivedAt))),
    q.select().from(products).where(and(eq(products.shopId, shopId), inArray(products.id, anyOf(t.productIds)), isNull(products.archivedAt))),
    q.select().from(employees).where(and(eq(employees.shopId, shopId), inArray(employees.id, anyOf(t.employeeIds)), eq(employees.active, true))),
    t.budgets ? q.select().from(expenseBudgets).where(eq(expenseBudgets.shopId, shopId)) : Promise.resolve([]),
    q.select({ salePricePerLitreCents: shops.salePricePerLitreCents }).from(shops).where(eq(shops.id, shopId)),
  ]);
  const kept = new Set(keptCustomers.map((c) => c.id));
  return {
    customers: keptCustomers,
    suppliers: keptSuppliers,
    products: keptProducts,
    staff: keptStaff,
    subscriptions: subs.filter((s) => kept.has(s.customerId)),
    budgets,
    salePriceCents: t.salePrice ? (shop?.salePricePerLitreCents ?? null) : null,
  };
}

const summarize = (k: Awaited<ReturnType<typeof selectKept>>): DemoKeepSummary => ({
  customers: k.customers.length,
  suppliers: k.suppliers.length,
  products: k.products.length,
  staff: k.staff.length,
  subscriptions: k.subscriptions.length,
  budgets: k.budgets.length,
  salePrice: k.salePriceCents != null,
});

/** What signing up would keep from this demo shop (for the sign-up page). */
export async function summarizeDemoKeep(db: DB, demoShopId: string): Promise<DemoKeepSummary> {
  return summarize(await selectKept(db, demoShopId));
}

export const keptAnything = (s: DemoKeepSummary) =>
  s.salePrice || s.customers + s.suppliers + s.products + s.staff + s.subscriptions + s.budgets > 0;

/**
 * Copy the visitor's own setup from a demo shop into their new real shop.
 * Runs inside completeSignup's transaction; `fromShopId` comes from the
 * server-held pending sign-up, never from the browser. Only reads a shop
 * that is still a demo.
 */
export async function copyDemoSetup(tx: Tx, fromShopId: string, toShopId: string): Promise<DemoKeepSummary | null> {
  const [source] = await tx.select({ demoExpiresAt: shops.demoExpiresAt }).from(shops).where(eq(shops.id, fromShopId));
  if (!source?.demoExpiresAt) return null;
  const k = await selectKept(tx, fromShopId);

  if (k.salePriceCents != null) {
    await tx.update(shops).set({ salePricePerLitreCents: k.salePriceCents }).where(eq(shops.id, toShopId));
  }
  const customerIds = new Map<string, string>();
  for (const c of k.customers) {
    const [row] = await tx
      .insert(customers)
      .values({ shopId: toShopId, name: c.name, phone: c.phone, address: c.address, creditLimitCents: c.creditLimitCents })
      .returning({ id: customers.id });
    customerIds.set(c.id, row.id);
  }
  if (k.suppliers.length) {
    await tx.insert(suppliers).values(
      k.suppliers.map((s) => ({ shopId: toShopId, name: s.name, phone: s.phone, defaultPricePerLitreCents: s.defaultPricePerLitreCents })),
    );
  }
  if (k.products.length) {
    await tx.insert(products).values(
      k.products.map((p) => ({
        shopId: toShopId,
        name: p.name,
        unit: p.unit,
        salePriceCents: p.salePriceCents,
        costPriceCents: p.costPriceCents,
        reorderLevel: p.reorderLevel,
      })),
    );
  }
  if (k.staff.length) {
    await tx.insert(employees).values(
      k.staff.map((e) => ({
        shopId: toShopId,
        name: e.name,
        phone: e.phone,
        payType: e.payType,
        rateCents: e.rateCents,
        startDate: e.startDate,
        statutory: e.statutory,
        kraPin: e.kraPin,
        nssfNumber: e.nssfNumber,
        shaNumber: e.shaNumber,
      })),
    );
  }
  const today = todayBusinessDate();
  if (k.subscriptions.length) {
    await tx.insert(subscriptions).values(
      k.subscriptions.map((s) => ({
        shopId: toShopId,
        customerId: customerIds.get(s.customerId)!,
        dailyMl: s.dailyMl,
        pricePerLitreCents: s.pricePerLitreCents,
        // Starts in the real shop, never back in the demo's sample past.
        startDate: s.startDate > today ? s.startDate : today,
        status: s.status,
      })),
    );
  }
  if (k.budgets.length) {
    await tx.insert(expenseBudgets).values(k.budgets.map((b) => ({ shopId: toShopId, category: b.category, monthlyCents: b.monthlyCents })));
  }
  return summarize(k);
}
