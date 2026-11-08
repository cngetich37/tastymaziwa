import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

// Money is integer cents and volume is integer millilitres (see src/lib/money.ts).
// `mode: 'number'` is safe: Number.MAX_SAFE_INTEGER cents ≈ KSh 90 trillion.
const cents = (name: string) => bigint(name, { mode: 'number' });
const millilitres = (name: string) => bigint(name, { mode: 'number' });
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const roleEnum = pgEnum('role', ['owner', 'attendant']);

export const entryKindEnum = pgEnum('entry_kind', [
  'delivery', // milk bought in from a supplier (adds to payable)
  'sale', // milk sold to a customer
  'customer_payment', // customer pays down credit
  'supplier_payment', // shop pays the milkman
  'expense', // operating cost (transport, packaging, power…)
  'spoilage', // milk written off (volume only)
]);

export const paymentMethodEnum = pgEnum('payment_method', ['cash', 'mpesa', 'credit']);

export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'active',
  'paused',
  'cancelled',
]);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: roleEnum('role').notNull().default('attendant'),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
});

export const customers = pgTable('customers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  /** E.164, e.g. +254712345678 */
  phone: text('phone'),
  address: text('address'),
  createdAt: createdAt(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
});

export const suppliers = pgTable('suppliers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  phone: text('phone'),
  /** Pre-fills the delivery form. */
  defaultPricePerLitreCents: cents('default_price_per_litre_cents'),
  createdAt: createdAt(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
});

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    dailyMl: millilitres('daily_ml').notNull(),
    pricePerLitreCents: cents('price_per_litre_cents').notNull(),
    startDate: date('start_date').notNull(),
    status: subscriptionStatusEnum('status').notNull().default('active'),
    createdAt: createdAt(),
  },
  (t) => [
    check('subscriptions_positive', sql`${t.dailyMl} > 0 and ${t.pricePerLitreCents} >= 0`),
  ],
);

/**
 * Append-only ledger. Rows are never updated or deleted; a mistake is
 * corrected by inserting a reversal (negated amounts, `reverses_id` set).
 * Every balance and report is derived from this table.
 */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: entryKindEnum('kind').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    /** Nairobi calendar day the entry belongs to; used for all daily grouping. */
    businessDate: date('business_date').notNull(),
    volumeMl: millilitres('volume_ml').notNull().default(0),
    amountCents: cents('amount_cents').notNull().default(0),
    unitPriceCents: cents('unit_price_cents'),
    paymentMethod: paymentMethodEnum('payment_method'),
    customerId: uuid('customer_id').references(() => customers.id),
    supplierId: uuid('supplier_id').references(() => suppliers.id),
    subscriptionId: uuid('subscription_id').references(() => subscriptions.id),
    expenseCategory: text('expense_category'),
    /** For credit sales: when payment is expected. */
    dueDate: date('due_date'),
    note: text('note'),
    reversesId: uuid('reverses_id')
      .unique()
      .references((): AnyPgColumn => ledgerEntries.id),
    /** Makes retried or scheduled writes safe, e.g. `sub:<id>:<date>`. */
    idempotencyKey: text('idempotency_key').unique(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('ledger_business_date_idx').on(t.businessDate),
    index('ledger_customer_idx').on(t.customerId),
    index('ledger_supplier_idx').on(t.supplierId),
    check(
      'ledger_originals_non_negative',
      sql`${t.reversesId} is not null or (${t.amountCents} >= 0 and ${t.volumeMl} >= 0)`,
    ),
    check(
      'ledger_sale_has_method',
      sql`${t.kind} <> 'sale' or ${t.paymentMethod} is not null`,
    ),
    check(
      'ledger_credit_sale_has_customer',
      sql`${t.paymentMethod} is distinct from 'credit' or ${t.customerId} is not null`,
    ),
    check(
      'ledger_customer_payment_has_customer',
      sql`${t.kind} <> 'customer_payment' or (${t.customerId} is not null and ${t.paymentMethod} in ('cash', 'mpesa'))`,
    ),
    check(
      'ledger_supplier_entries_have_supplier',
      sql`${t.kind} not in ('delivery', 'supplier_payment') or ${t.supplierId} is not null`,
    ),
  ],
);

/** Who did what, when. Written in the same transaction as the change. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    data: jsonb('data'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_created_at_idx').on(t.createdAt)],
);

export type User = typeof users.$inferSelect;
export type Role = (typeof roleEnum.enumValues)[number];
export type Customer = typeof customers.$inferSelect;
export type Supplier = typeof suppliers.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type LedgerEntry = typeof ledgerEntries.$inferSelect;
export type NewLedgerEntry = typeof ledgerEntries.$inferInsert;
