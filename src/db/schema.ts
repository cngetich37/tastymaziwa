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

/** owner = the shop's admin; attendant = the milk seller; supplier = a milkman's own login. */
export const roleEnum = pgEnum('role', ['owner', 'attendant', 'supplier']);

export const entryKindEnum = pgEnum('entry_kind', [
  'delivery', // milk bought in from a supplier (adds to payable)
  'sale', // milk sold to a customer
  'customer_payment', // customer pays down credit
  'supplier_payment', // shop pays the milkman
  'expense', // operating cost (transport, packaging, power…)
  'spoilage', // milk written off (volume only)
]);

export const paymentMethodEnum = pgEnum('payment_method', ['cash', 'mpesa', 'credit']);

/** How a product is counted. Quantities are stored in thousandths: ml, milli-pieces, grams. */
export const productUnitEnum = pgEnum('product_unit', ['litre', 'piece', 'kg']);

export const deliverySubmissionStatusEnum = pgEnum('delivery_submission_status', [
  'pending', // recorded by the supplier, waiting for the seller
  'approved', // the seller confirmed the litres; posted to the ledger
  'rejected', // the litres were wrong; the supplier records it again
]);

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
  /** E.164 WhatsApp number the owner gets stock updates on. Null = off. */
  stockAlertWhatsapp: text('stock_alert_whatsapp'),
  /**
   * Set only on a "Try the demo" sandbox (server/demo): when it is purged.
   * Null = a real shop. A trigger stops a real shop ever becoming a demo,
   * and only expired demos may have ledger/audit rows deleted.
   */
  demoExpiresAt: timestamp('demo_expires_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index('shops_demo_expires_idx').on(t.demoExpiresAt).where(sql`${t.demoExpiresAt} is not null`)]);

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
    /** Set only for supplier logins: the supplier (milkman) this person is. */
    supplierId: uuid('supplier_id').unique(),
    active: boolean('active').notNull().default(true),
    /** Bumped on password reset/change; older sessions are rejected. */
    sessionVersion: integer('session_version').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index('users_shop_idx').on(t.shopId),
    foreignKey({
      name: 'users_supplier_same_shop_fk',
      columns: [t.supplierId, t.shopId],
      foreignColumns: [suppliers.id, suppliers.shopId],
    }),
    // ::text so the check doesn't use the new enum value in the migration that adds it.
    check('users_supplier_role', sql`(${t.role}::text = 'supplier') = (${t.supplierId} is not null)`),
  ],
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
    /** Most they may owe. A sale that would go over it needs the owner. Null = no limit. */
    creditLimitCents: cents('credit_limit_cents'),
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

/**
 * What the shop sells besides fresh milk (mala, yoghurt, ghee, packets…).
 * Fresh milk itself is not a row: a ledger entry with no product is milk,
 * priced by `shops.sale_price_per_litre_cents` and each supplier's price.
 */
export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: shopId(),
    name: text('name').notNull(),
    unit: productUnitEnum('unit').notNull().default('piece'),
    /** Per unit (per litre, per piece, per kg). Sellers always sell at this price. */
    salePriceCents: cents('sale_price_cents'),
    /** Usual buying price per unit; pre-fills stock purchases. */
    costPriceCents: cents('cost_price_cents'),
    /** Warn when stock falls to this many thousandths of a unit or below. */
    reorderLevel: millilitres('reorder_level'),
    createdAt: createdAt(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    unique('products_id_shop_unique').on(t.id, t.shopId),
    index('products_shop_idx').on(t.shopId),
    check(
      'products_non_negative',
      sql`coalesce(${t.salePriceCents}, 0) >= 0 and coalesce(${t.costPriceCents}, 0) >= 0 and coalesce(${t.reorderLevel}, 0) >= 0`,
    ),
  ],
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
    /** Null = fresh milk. Otherwise `volume_ml` is thousandths of the product's unit. */
    productId: uuid('product_id'),
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
    index('ledger_shop_product_idx').on(t.shopId, t.productId),
    foreignKey({
      name: 'ledger_product_same_shop_fk',
      columns: [t.productId, t.shopId],
      foreignColumns: [products.id, products.shopId],
    }),
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

/**
 * Deliveries a supplier records themselves. They don't count until the seller
 * approves the litres: approval posts a `delivery` to the ledger (and links
 * it here); a rejection sends it back with a reason. Separation of duties:
 * the person who delivers never confirms their own delivery.
 */
export const deliverySubmissions = pgTable(
  'delivery_submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: shopId(),
    supplierId: uuid('supplier_id').notNull(),
    /** Nairobi day of the delivery, set by the server when it is recorded. */
    businessDate: date('business_date').notNull(),
    volumeMl: millilitres('volume_ml').notNull(),
    note: text('note'),
    status: deliverySubmissionStatusEnum('status').notNull().default('pending'),
    submittedBy: uuid('submitted_by')
      .notNull()
      .references(() => users.id),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    /** Why it was rejected (required), or an optional note on approval. */
    reviewNote: text('review_note'),
    /** The ledger delivery created on approval. */
    ledgerEntryId: uuid('ledger_entry_id').unique(),
  },
  (t) => [
    index('delivery_submissions_shop_status_idx').on(t.shopId, t.status),
    index('delivery_submissions_shop_date_idx').on(t.shopId, t.businessDate),
    index('delivery_submissions_supplier_idx').on(t.supplierId),
    foreignKey({
      name: 'delivery_submissions_supplier_same_shop_fk',
      columns: [t.supplierId, t.shopId],
      foreignColumns: [suppliers.id, suppliers.shopId],
    }),
    foreignKey({
      name: 'delivery_submissions_ledger_same_shop_fk',
      columns: [t.ledgerEntryId, t.shopId],
      foreignColumns: [ledgerEntries.id, ledgerEntries.shopId],
    }),
    check('delivery_submissions_positive', sql`${t.volumeMl} > 0`),
    check(
      'delivery_submissions_review_consistent',
      sql`(${t.status} = 'pending' and ${t.reviewedAt} is null and ${t.ledgerEntryId} is null)
        or (${t.status} = 'approved' and ${t.reviewedAt} is not null and ${t.ledgerEntryId} is not null)
        or (${t.status} = 'rejected' and ${t.reviewedAt} is not null and ${t.ledgerEntryId} is null and ${t.reviewNote} is not null)`,
    ),
  ],
);

export const shiftCloseStatusEnum = pgEnum('shift_close_status', ['submitted', 'approved']);

/**
 * End-of-shift cash-up. The seller counts cash, M-Pesa and milk "blind"
 * (without seeing what is expected); the server snapshots the expected
 * figures for everything recorded since the previous close. The owner then
 * reviews the variance and may write a milk shortfall off as spoilage.
 */
export const shiftCloses = pgTable(
  'shift_closes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: shopId(),
    businessDate: date('business_date').notNull(),
    /** Start of the window: the previous close, or null for the shop's first. */
    periodStart: timestamp('period_start', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }).notNull().defaultNow(),
    closedBy: uuid('closed_by')
      .notNull()
      .references(() => users.id),
    openingFloatCents: cents('opening_float_cents').notNull().default(0),
    expectedCashCents: cents('expected_cash_cents').notNull(),
    countedCashCents: cents('counted_cash_cents').notNull(),
    expectedMpesaCents: cents('expected_mpesa_cents').notNull(),
    countedMpesaCents: cents('counted_mpesa_cents').notNull(),
    expectedMilkMl: millilitres('expected_milk_ml').notNull(),
    countedMilkMl: millilitres('counted_milk_ml').notNull(),
    note: text('note'),
    status: shiftCloseStatusEnum('status').notNull().default('submitted'),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewNote: text('review_note'),
    /** The spoilage entry that wrote off a milk shortfall, if the owner chose to. */
    spoilageEntryId: uuid('spoilage_entry_id'),
  },
  (t) => [
    index('shift_closes_shop_closed_idx').on(t.shopId, t.closedAt),
    foreignKey({
      name: 'shift_closes_spoilage_same_shop_fk',
      columns: [t.spoilageEntryId, t.shopId],
      foreignColumns: [ledgerEntries.id, ledgerEntries.shopId],
    }),
    check(
      'shift_closes_counts_non_negative',
      sql`${t.openingFloatCents} >= 0 and ${t.countedCashCents} >= 0 and ${t.countedMpesaCents} >= 0 and ${t.countedMilkMl} >= 0`,
    ),
    check(
      'shift_closes_review_consistent',
      sql`(${t.status} = 'submitted') = (${t.reviewedAt} is null)`,
    ),
  ],
);

/** A monthly spending limit per expense category (Finance → Expenses). */
export const expenseBudgets = pgTable(
  'expense_budgets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: shopId(),
    category: text('category').notNull(),
    monthlyCents: cents('monthly_cents').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('expense_budgets_shop_category_unique').on(t.shopId, t.category),
    check('expense_budgets_non_negative', sql`${t.monthlyCents} >= 0`),
  ],
);

export const payTypeEnum = pgEnum('pay_type', ['daily', 'monthly']);

/** People who work in the shop, with or without a login. */
export const employees = pgTable(
  'employees',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: shopId(),
    name: text('name').notNull(),
    phone: text('phone'),
    payType: payTypeEnum('pay_type').notNull(),
    /** Per day worked (daily) or per month (monthly). */
    rateCents: cents('rate_cents').notNull(),
    startDate: date('start_date').notNull(),
    /** Formally employed: NSSF, SHIF, housing levy and PAYE are deducted. */
    statutory: boolean('statutory').notNull().default(false),
    kraPin: text('kra_pin'),
    nssfNumber: text('nssf_number'),
    shaNumber: text('sha_number'),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    unique('employees_id_shop_unique').on(t.id, t.shopId),
    index('employees_shop_idx').on(t.shopId),
    check('employees_rate_non_negative', sql`${t.rateCents} >= 0`),
  ],
);

/** One row per person per day they worked. */
export const attendance = pgTable(
  'attendance',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: shopId(),
    employeeId: uuid('employee_id').notNull(),
    businessDate: date('business_date').notNull(),
    markedBy: uuid('marked_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique('attendance_employee_date_unique').on(t.employeeId, t.businessDate),
    index('attendance_shop_date_idx').on(t.shopId, t.businessDate),
    foreignKey({
      name: 'attendance_employee_same_shop_fk',
      columns: [t.employeeId, t.shopId],
      foreignColumns: [employees.id, employees.shopId],
    }),
  ],
);

/**
 * Payroll for one calendar month (`YYYY-MM`), posted once. Each line's net
 * pay is a `wages` expense in the ledger.
 */
export const payrollRuns = pgTable(
  'payroll_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: shopId(),
    month: text('month').notNull(),
    paymentMethod: paymentMethodEnum('payment_method').notNull(),
    grossCents: cents('gross_cents').notNull(),
    advancesCents: cents('advances_cents').notNull(),
    netCents: cents('net_cents').notNull(),
    /** Employee deductions + employer contributions owed to KRA / NSSF / SHA. */
    statutoryDueCents: cents('statutory_due_cents').notNull().default(0),
    remittedAt: timestamp('remitted_at', { withTimezone: true }),
    remittanceEntryId: uuid('remittance_entry_id'),
    postedBy: uuid('posted_by').references(() => users.id),
    postedAt: timestamp('posted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('payroll_runs_id_shop_unique').on(t.id, t.shopId),
    unique('payroll_runs_shop_month_unique').on(t.shopId, t.month),
    check('payroll_runs_method', sql`${t.paymentMethod} in ('cash', 'mpesa')`),
    foreignKey({
      name: 'payroll_runs_remittance_same_shop_fk',
      columns: [t.remittanceEntryId, t.shopId],
      foreignColumns: [ledgerEntries.id, ledgerEntries.shopId],
    }),
  ],
);

export const payrollLines = pgTable(
  'payroll_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: shopId(),
    runId: uuid('run_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    daysWorked: integer('days_worked').notNull(),
    grossCents: cents('gross_cents').notNull(),
    advancesCents: cents('advances_cents').notNull(),
    netCents: cents('net_cents').notNull(),
    nssfCents: cents('nssf_cents').notNull().default(0),
    shifCents: cents('shif_cents').notNull().default(0),
    housingLevyCents: cents('housing_levy_cents').notNull().default(0),
    taxableCents: cents('taxable_cents').notNull().default(0),
    payeCents: cents('paye_cents').notNull().default(0),
    employerNssfCents: cents('employer_nssf_cents').notNull().default(0),
    employerHousingLevyCents: cents('employer_housing_levy_cents').notNull().default(0),
    employerNitaCents: cents('employer_nita_cents').notNull().default(0),
    /** The wages expense for the net pay; null when nothing was left to pay. */
    ledgerEntryId: uuid('ledger_entry_id'),
  },
  (t) => [
    index('payroll_lines_run_idx').on(t.runId),
    foreignKey({ name: 'payroll_lines_run_same_shop_fk', columns: [t.runId, t.shopId], foreignColumns: [payrollRuns.id, payrollRuns.shopId] }),
    foreignKey({
      name: 'payroll_lines_employee_same_shop_fk',
      columns: [t.employeeId, t.shopId],
      foreignColumns: [employees.id, employees.shopId],
    }),
    foreignKey({
      name: 'payroll_lines_ledger_same_shop_fk',
      columns: [t.ledgerEntryId, t.shopId],
      foreignColumns: [ledgerEntries.id, ledgerEntries.shopId],
    }),
  ],
);

/**
 * Money given to staff before payday. Paid out at once (a `wages` expense),
 * then deducted from the next payroll that settles it. A carried-forward
 * remainder has no ledger entry: that money was already paid out.
 */
export const employeeAdvances = pgTable(
  'employee_advances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: shopId(),
    employeeId: uuid('employee_id').notNull(),
    businessDate: date('business_date').notNull(),
    amountCents: cents('amount_cents').notNull(),
    note: text('note'),
    ledgerEntryId: uuid('ledger_entry_id'),
    settledInRunId: uuid('settled_in_run_id'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('employee_advances_shop_employee_idx').on(t.shopId, t.employeeId),
    foreignKey({
      name: 'employee_advances_employee_same_shop_fk',
      columns: [t.employeeId, t.shopId],
      foreignColumns: [employees.id, employees.shopId],
    }),
    foreignKey({
      name: 'employee_advances_ledger_same_shop_fk',
      columns: [t.ledgerEntryId, t.shopId],
      foreignColumns: [ledgerEntries.id, ledgerEntries.shopId],
    }),
    foreignKey({
      name: 'employee_advances_run_same_shop_fk',
      columns: [t.settledInRunId, t.shopId],
      foreignColumns: [payrollRuns.id, payrollRuns.shopId],
    }),
    check('employee_advances_positive', sql`${t.amountCents} > 0`),
  ],
);

export const mpesaEnvironmentEnum = pgEnum('mpesa_environment', ['sandbox', 'production']);
export const mpesaShortcodeTypeEnum = pgEnum('mpesa_shortcode_type', ['paybill', 'till']);
export const mpesaPurposeEnum = pgEnum('mpesa_purpose', ['sale', 'customer_payment']);
export const mpesaStatusEnum = pgEnum('mpesa_status', ['pending', 'succeeded', 'failed']);

/**
 * A shop's own Lipa na M-Pesa (Daraja) credentials. Secrets are stored
 * encrypted (AES-256-GCM, see server/mpesa/crypto.ts) and never sent to a
 * browser.
 */
export const mpesaSettings = pgTable('mpesa_settings', {
  shopId: uuid('shop_id')
    .primaryKey()
    .references(() => shops.id),
  enabled: boolean('enabled').notNull().default(true),
  environment: mpesaEnvironmentEnum('environment').notNull().default('sandbox'),
  shortcodeType: mpesaShortcodeTypeEnum('shortcode_type').notNull(),
  /** Paybill number, or for a till the head office (store) number. */
  businessShortcode: text('business_shortcode').notNull(),
  /** Buy Goods till number (tills only). */
  tillNumber: text('till_number'),
  /** Shown to the customer on the PIN prompt (12 characters at most). */
  accountReference: text('account_reference').notNull(),
  consumerKeyEnc: text('consumer_key_enc').notNull(),
  consumerSecretEnc: text('consumer_secret_enc').notNull(),
  passkeyEnc: text('passkey_enc').notNull(),
  /** Till/paybill reconciliation (C2B): HMAC of the secret in the registered URLs. */
  c2bTokenHash: text('c2b_token_hash'),
  c2bRegisteredAt: timestamp('c2b_registered_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One STK Push (PIN prompt) sent to a customer's phone. Nothing reaches the
 * ledger until M-Pesa confirms it; then the sale or payment is posted once.
 */
export const mpesaRequests = pgTable(
  'mpesa_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: shopId(),
    purpose: mpesaPurposeEnum('purpose').notNull(),
    status: mpesaStatusEnum('status').notNull().default('pending'),
    /** Whole shillings, in cents. */
    amountCents: cents('amount_cents').notNull(),
    /** E.164, e.g. +254712345678 */
    phone: text('phone').notNull(),
    businessDate: date('business_date').notNull(),
    customerId: uuid('customer_id'),
    productId: uuid('product_id'),
    volumeMl: millilitres('volume_ml').notNull().default(0),
    unitPriceCents: cents('unit_price_cents'),
    note: text('note'),
    /** HMAC of the secret in this request's callback URL. */
    callbackTokenHash: text('callback_token_hash').notNull(),
    merchantRequestId: text('merchant_request_id'),
    checkoutRequestId: text('checkout_request_id').unique(),
    resultCode: integer('result_code'),
    resultDesc: text('result_desc'),
    receiptNumber: text('receipt_number').unique(),
    ledgerEntryId: uuid('ledger_entry_id'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    index('mpesa_requests_shop_created_idx').on(t.shopId, t.createdAt),
    index('mpesa_requests_shop_phone_status_idx').on(t.shopId, t.phone, t.status),
    foreignKey({
      name: 'mpesa_requests_customer_same_shop_fk',
      columns: [t.customerId, t.shopId],
      foreignColumns: [customers.id, customers.shopId],
    }),
    foreignKey({
      name: 'mpesa_requests_product_same_shop_fk',
      columns: [t.productId, t.shopId],
      foreignColumns: [products.id, products.shopId],
    }),
    foreignKey({
      name: 'mpesa_requests_ledger_same_shop_fk',
      columns: [t.ledgerEntryId, t.shopId],
      foreignColumns: [ledgerEntries.id, ledgerEntries.shopId],
    }),
    check('mpesa_requests_whole_shillings', sql`${t.amountCents} > 0 and ${t.amountCents} % 100 = 0`),
    check(
      'mpesa_requests_payment_has_customer',
      sql`${t.purpose} <> 'customer_payment' or ${t.customerId} is not null`,
    ),
    check(
      'mpesa_requests_success_posted',
      sql`${t.status} <> 'succeeded' or ${t.ledgerEntryId} is not null`,
    ),
  ],
);

export const c2bStatusEnum = pgEnum('c2b_status', [
  'stk', // the shop's own STK prompt: already posted
  'matched_sale', // confirms a sale a seller recorded as M-Pesa
  'posted_payment', // posted as a customer paying their deni
  'unmatched', // in the owner's "match this payment" inbox
  'ignored', // not shop business (e.g. a personal transfer), with a note
]);

/**
 * Money paid straight to the shop's till or paybill, as Safaricom confirms
 * it (C2B). Each payment is reconciled once: linked to what the books
 * already show, posted as a customer payment, or left for the owner.
 */
export const mpesaC2bTransactions = pgTable(
  'mpesa_c2b_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: shopId(),
    /** Safaricom's receipt, e.g. UCB030CBG1. */
    transId: text('trans_id').notNull().unique(),
    transType: text('trans_type'),
    transTime: timestamp('trans_time', { withTimezone: true }).notNull(),
    businessDate: date('business_date').notNull(),
    amountCents: cents('amount_cents').notNull(),
    businessShortcode: text('business_shortcode').notNull(),
    /** Paybill account number the customer typed (empty for tills). */
    billRef: text('bill_ref'),
    /** As received: a phone, a masked phone, or (live) a SHA-256 of it. */
    msisdn: text('msisdn'),
    payerName: text('payer_name'),
    orgBalanceCents: cents('org_balance_cents'),
    status: c2bStatusEnum('status').notNull(),
    /** The likely payer, for the inbox; or who it was posted for. */
    customerId: uuid('customer_id'),
    /** The sale it confirms, or the payment / STK entry posted for it. */
    ledgerEntryId: uuid('ledger_entry_id').unique(),
    matchedBy: uuid('matched_by').references(() => users.id),
    matchedAt: timestamp('matched_at', { withTimezone: true }),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [
    index('mpesa_c2b_shop_date_idx').on(t.shopId, t.businessDate),
    index('mpesa_c2b_shop_status_idx').on(t.shopId, t.status),
    foreignKey({
      name: 'mpesa_c2b_customer_same_shop_fk',
      columns: [t.customerId, t.shopId],
      foreignColumns: [customers.id, customers.shopId],
    }),
    foreignKey({
      name: 'mpesa_c2b_ledger_same_shop_fk',
      columns: [t.ledgerEntryId, t.shopId],
      foreignColumns: [ledgerEntries.id, ledgerEntries.shopId],
    }),
    check('mpesa_c2b_positive', sql`${t.amountCents} > 0`),
    check(
      'mpesa_c2b_linked',
      sql`(${t.status} in ('unmatched', 'ignored')) = (${t.ledgerEntryId} is null)`,
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
export type Product = typeof products.$inferSelect;
export type ProductUnit = (typeof productUnitEnum.enumValues)[number];
export type Subscription = typeof subscriptions.$inferSelect;
export type DeliverySubmission = typeof deliverySubmissions.$inferSelect;
export type DeliverySubmissionStatus = (typeof deliverySubmissionStatusEnum.enumValues)[number];
export type ShiftClose = typeof shiftCloses.$inferSelect;
export type Employee = typeof employees.$inferSelect;
export type PayType = (typeof payTypeEnum.enumValues)[number];
export type MpesaSettings = typeof mpesaSettings.$inferSelect;
export type MpesaRequest = typeof mpesaRequests.$inferSelect;
export type C2bTransaction = typeof mpesaC2bTransactions.$inferSelect;
export type LedgerEntry = typeof ledgerEntries.$inferSelect;
export type NewLedgerEntry = typeof ledgerEntries.$inferInsert;
export type AuthTokenPurpose = (typeof authTokenPurposeEnum.enumValues)[number];
