import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
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

export const authTokenPurposeEnum = pgEnum('auth_token_purpose', [
  'signup', // 6-digit code; `data` holds the pending account until verified
  'login_code', // 6-digit passwordless sign-in code
  'password_reset', // long random token in an emailed link (also used for staff invites)
  'email_change', // 6-digit code sent to the new address; `data.newEmail`
]);

/**
 * A tenant. Every business row belongs to exactly one shop, and composite
 * foreign keys (…, shop_id) stop rows from referencing another shop's data.
 */
export const shops = pgTable('shops', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  /** The owner's selling price per litre. Attendants' sales always use it. */
  salePricePerLitreCents: cents('sale_price_per_litre_cents'),
  createdAt: createdAt(),
});

const shopId = () =>
  uuid('shop_id')
    .notNull()
    .references(() => shops.id);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: shopId(),
    name: text('name').notNull(),
    /** Lower-cased; the sign-in identifier. Unique across all shops. */
    email: text('email').notNull().unique(),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    /** Null until the user sets one (invited staff, passwordless-only users). */
    passwordHash: text('password_hash'),
    role: roleEnum('role').notNull().default('attendant'),
    active: boolean('active').notNull().default(true),
    /** Bumped on password reset/change; older sessions are rejected. */
    sessionVersion: integer('session_version').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('users_shop_idx').on(t.shopId)],
);

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: shopId(),
    name: text('name').notNull(),
    /** E.164, e.g. +254712345678 */
    phone: text('phone'),
    address: text('address'),
    createdAt: createdAt(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [unique('customers_id_shop_unique').on(t.id, t.shopId), index('customers_shop_idx').on(t.shopId)],
);

export const suppliers = pgTable(
  'suppliers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: shopId(),
    name: text('name').notNull(),
    phone: text('phone'),
    /** Pre-fills the delivery form. */
    defaultPricePerLitreCents: cents('default_price_per_litre_cents'),
    createdAt: createdAt(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [unique('suppliers_id_shop_unique').on(t.id, t.shopId), index('suppliers_shop_idx').on(t.shopId)],
);

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: shopId(),
    customerId: uuid('customer_id').notNull(),
    dailyMl: millilitres('daily_ml').notNull(),
    pricePerLitreCents: cents('price_per_litre_cents').notNull(),
    startDate: date('start_date').notNull(),
    status: subscriptionStatusEnum('status').notNull().default('active'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('subscriptions_id_shop_unique').on(t.id, t.shopId),
    foreignKey({
      name: 'subscriptions_customer_same_shop_fk',
      columns: [t.customerId, t.shopId],
      foreignColumns: [customers.id, customers.shopId],
    }),
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
    shopId: shopId(),
    kind: entryKindEnum('kind').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    /** Nairobi calendar day the entry belongs to; used for all daily grouping. */
    businessDate: date('business_date').notNull(),
    volumeMl: millilitres('volume_ml').notNull().default(0),
    amountCents: cents('amount_cents').notNull().default(0),
    unitPriceCents: cents('unit_price_cents'),
    paymentMethod: paymentMethodEnum('payment_method'),
    customerId: uuid('customer_id'),
    supplierId: uuid('supplier_id'),
    subscriptionId: uuid('subscription_id'),
    expenseCategory: text('expense_category'),
    /** For credit sales: when payment is expected. */
    dueDate: date('due_date'),
    note: text('note'),
    reversesId: uuid('reverses_id').unique(),
    /** Makes retried or scheduled writes safe, e.g. `sub:<id>:<date>`. */
    idempotencyKey: text('idempotency_key').unique(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique('ledger_entries_id_shop_unique').on(t.id, t.shopId),
    index('ledger_shop_date_idx').on(t.shopId, t.businessDate),
    index('ledger_customer_idx').on(t.customerId),
    index('ledger_supplier_idx').on(t.supplierId),
    // Composite keys: a referenced row must belong to the same shop. NULL
    // columns skip the check (MATCH SIMPLE), so optional references still work.
    foreignKey({
      name: 'ledger_customer_same_shop_fk',
      columns: [t.customerId, t.shopId],
      foreignColumns: [customers.id, customers.shopId],
    }),
    foreignKey({
      name: 'ledger_supplier_same_shop_fk',
      columns: [t.supplierId, t.shopId],
      foreignColumns: [suppliers.id, suppliers.shopId],
    }),
    foreignKey({
      name: 'ledger_subscription_same_shop_fk',
      columns: [t.subscriptionId, t.shopId],
      foreignColumns: [subscriptions.id, subscriptions.shopId],
    }),
    foreignKey({
      name: 'ledger_reverses_same_shop_fk',
      columns: [t.reversesId, t.shopId],
      foreignColumns: [t.id, t.shopId],
    }),
    check(
      'ledger_originals_non_negative',
      sql`${t.reversesId} is not null or (${t.amountCents} >= 0 and ${t.volumeMl} >= 0)`,
    ),
    check('ledger_sale_has_method', sql`${t.kind} <> 'sale' or ${t.paymentMethod} is not null`),
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
    /** Null only for system-wide events (e.g. housekeeping). */
    shopId: uuid('shop_id').references(() => shops.id),
    userId: uuid('user_id').references(() => users.id),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    data: jsonb('data'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_shop_created_idx').on(t.shopId, t.createdAt)],
);

/**
 * One-time secrets for email flows. Only an HMAC of the code/token is stored.
 * Codes expire quickly and allow a few attempts; all are single-use.
 */
export const authTokens = pgTable(
  'auth_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    purpose: authTokenPurposeEnum('purpose').notNull(),
    /** Lower-cased address the secret was sent to. */
    email: text('email').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    data: jsonb('data'),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('auth_tokens_email_purpose_idx').on(t.email, t.purpose),
    index('auth_tokens_hash_idx').on(t.tokenHash),
  ],
);

/** Sliding-window rate limiting (e.g. `login-fail:<email>`, `send-code:ip:<ip>`). */
export const rateLimitEvents = pgTable(
  'rate_limit_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    key: text('key').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('rate_limit_key_created_idx').on(t.key, t.createdAt)],
);

export type Shop = typeof shops.$inferSelect;
export type User = typeof users.$inferSelect;
export type Role = (typeof roleEnum.enumValues)[number];
export type Customer = typeof customers.$inferSelect;
export type Supplier = typeof suppliers.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type LedgerEntry = typeof ledgerEntries.$inferSelect;
export type NewLedgerEntry = typeof ledgerEntries.$inferInsert;
export type AuthTokenPurpose = (typeof authTokenPurposeEnum.enumValues)[number];
