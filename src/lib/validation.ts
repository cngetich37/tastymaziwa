/**
 * Input schemas shared by forms (client) and server actions (server). Form
 * fields are strings; schemas parse them into integer cents / millilitres.
 */
import { z } from 'zod';
import { kesToCents, litresToMl } from './money';
import { todayBusinessDate } from './dates';

// --- primitives -------------------------------------------------------------

function scaledField(parse: (s: string) => number, label: string, opts: { allowZero?: boolean }) {
  return z
    .string({ error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .transform((value, ctx) => {
      let n: number;
      try {
        n = parse(value);
      } catch {
        ctx.addIssue({ code: 'custom', message: `Enter a valid ${label.toLowerCase()}` });
        return z.NEVER;
      }
      if (n < 0 || (!opts.allowZero && n === 0)) {
        ctx.addIssue({
          code: 'custom',
          message: `${label} must be ${opts.allowZero ? 'zero or more' : 'more than zero'}`,
        });
        return z.NEVER;
      }
      return n;
    });
}

/** KES string → integer cents (> 0) */
export const kesField = (label = 'Amount') => scaledField(kesToCents, label, {});
/** KES string → integer cents (≥ 0) */
export const kesFieldAllowZero = (label = 'Amount') =>
  scaledField(kesToCents, label, { allowZero: true });
/** Litres string → integer millilitres (> 0) */
export const litresField = (label = 'Litres') => scaledField(litresToMl, label, {});

/**
 * An optional form field: missing or blank ('' / whitespace) becomes
 * `undefined`; anything else must pass `inner`. `.optional()` is outermost so
 * the key is optional in both the input and output types (zod 4 makes a key
 * required if a transform wraps the optional).
 */
function optionalField<T extends z.ZodType<unknown, string>>(inner: T) {
  return z
    .string()
    .transform((v) => (v.trim() === '' ? undefined : v))
    .pipe(inner.optional())
    .optional();
}

const optionalText = (max = 500) => optionalField(z.string().trim().max(max));

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/** Optional business date, defaults to today (Nairobi), never in the future. */
const entryDate = optionalField(
  isoDate.refine((v) => v <= todayBusinessDate(), 'Date cannot be in the future'),
);

const id = z.uuid({ error: 'Choose an option' });

/**
 * Normalise Kenyan mobile numbers to E.164: 0712 345 678, 712345678,
 * 254712345678 and +254712345678 all become +254712345678.
 */
export function normalizeKenyanPhone(input: string): string | null {
  const digits = input.replace(/[\s\-()]/g, '');
  const match = /^(?:\+?254|0)?([17]\d{8})$/.exec(digits);
  return match ? `+254${match[1]}` : null;
}

const phoneField = optionalField(
  z.string().transform((value, ctx) => {
    const normalized = normalizeKenyanPhone(value);
    if (!normalized) {
      ctx.addIssue({ code: 'custom', message: 'Enter a Kenyan mobile number, e.g. 0712 345 678' });
      return z.NEVER;
    }
    return normalized;
  }),
);

const requiredPhone = z
  .string({ error: 'Enter the M-Pesa phone number' })
  .trim()
  .min(1, 'Enter the M-Pesa phone number')
  .transform((value, ctx) => {
    const normalized = normalizeKenyanPhone(value);
    if (!normalized) {
      ctx.addIssue({ code: 'custom', message: 'Enter a Kenyan mobile number, e.g. 0712 345 678' });
      return z.NEVER;
    }
    return normalized;
  });

// --- enums ------------------------------------------------------------------

export const PAYMENT_METHODS = ['cash', 'mpesa', 'credit'] as const;
export const IMMEDIATE_PAYMENT_METHODS = ['cash', 'mpesa'] as const;

export const EXPENSE_CATEGORIES = [
  'transport',
  'packaging',
  'electricity',
  'rent',
  'wages',
  'equipment',
  /** NSSF, SHIF, housing levy and PAYE paid over (see Payroll). */
  'statutory',
  'other',
] as const;

export const SPOILAGE_REASONS = ['sour', 'spilled', 'power_outage', 'returned', 'other'] as const;

// --- entry schemas ----------------------------------------------------------

export const saleSchema = z
  .object({
    litres: litresField(),
    /** Owner-only override; blank means the shop's selling price. */
    pricePerLitre: optionalField(kesField('Price per litre')),
    paymentMethod: z.enum(PAYMENT_METHODS),
    /** Blank = fresh milk. `litres` is then the quantity in that product's unit. */
    productId: optionalField(id),
    customerId: optionalField(id),
    dueDate: optionalField(isoDate),
    date: entryDate,
    note: optionalText(),
  })
  .refine((v) => v.paymentMethod !== 'credit' || v.customerId, {
    error: 'Choose who is buying on credit',
    path: ['customerId'],
  });

export const deliverySchema = z.object({
  supplierId: id,
  /** Blank = fresh milk; a product = a stock purchase (owner only). */
  productId: optionalField(id),
  litres: litresField(),
  /** Owner-only override; blank means the supplier's agreed price. */
  pricePerLitre: optionalField(kesFieldAllowZero('Price per litre')),
  date: entryDate,
  note: optionalText(),
});

// --- finance ----------------------------------------------------------------------

/**
 * Pay several suppliers at once. `runKey` is generated by the form, so a
 * double tap or a retry can't pay anyone twice. Blank amounts are skipped.
 */
export const paySuppliersSchema = z
  .object({
    runKey: z.uuid(),
    paymentMethod: z.enum(IMMEDIATE_PAYMENT_METHODS),
    lines: z
      .array(z.object({ supplierId: id, amount: optionalField(kesField()) }))
      .max(200),
  })
  .refine((v) => v.lines.some((l) => l.amount), { error: 'Enter at least one amount', path: ['lines'] });

/** Monthly budget per expense category; blank removes it. */
export const budgetsSchema = z.object({
  budgets: z.array(z.object({ category: z.enum(EXPENSE_CATEGORIES), monthly: optionalField(kesFieldAllowZero('Budget')) })),
});

// --- staff & payroll --------------------------------------------------------------

export const PAY_TYPES = ['daily', 'monthly'] as const;

export const employeeSchema = z.object({
  name: z.string().trim().min(2, 'Enter a name').max(120),
  phone: phoneField,
  payType: z.enum(PAY_TYPES),
  rate: kesFieldAllowZero('Pay rate'),
  /** Defaults to today. */
  startDate: optionalField(isoDate),
  /** Formally employed: NSSF, SHIF, housing levy and PAYE apply. */
  statutory: z.boolean().default(false),
  kraPin: optionalField(
    z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[AP]\d{9}[A-Z]$/, 'A KRA PIN looks like A123456789B'),
  ),
  nssfNumber: optionalText(30),
  shaNumber: optionalText(30),
});

export const updateEmployeeSchema = employeeSchema.extend({ employeeId: id });
export const employeeActiveSchema = z.object({ employeeId: id, active: z.boolean() });

export const attendanceSchema = z.object({
  employeeId: id,
  date: entryDate,
  present: z.boolean(),
});

export const advanceSchema = z.object({
  employeeId: id,
  amount: kesField(),
  paymentMethod: z.enum(IMMEDIATE_PAYMENT_METHODS),
  note: optionalText(),
});

export const remitStatutorySchema = z.object({
  runId: id,
  paymentMethod: z.enum(IMMEDIATE_PAYMENT_METHODS),
});

export const postPayrollSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Choose a month'),
  paymentMethod: z.enum(IMMEDIATE_PAYMENT_METHODS),
});

// --- M-Pesa (Lipa na M-Pesa / STK Push) ---------------------------------------------

const digits = (label: string, min: number, max: number) =>
  z
    .string()
    .trim()
    .regex(/^[0-9]+$/, `${label} is digits only`)
    .min(min, `${label} is ${min}–${max} digits`)
    .max(max, `${label} is ${min}–${max} digits`);

/** Blank secret fields keep what is saved; they are required the first time (checked in the service). */
export const mpesaSettingsSchema = z
  .object({
    enabled: z.boolean().default(true),
    environment: z.enum(['sandbox', 'production']),
    shortcodeType: z.enum(['paybill', 'till']),
    businessShortcode: digits('The shortcode', 5, 7),
    tillNumber: optionalField(digits('The till number', 5, 7)),
    accountReference: z.string().trim().min(1, 'Enter a reference, e.g. your shop name').max(12, '12 characters at most'),
    consumerKey: optionalText(200),
    consumerSecret: optionalText(200),
    passkey: optionalText(200),
  })
  .refine((v) => v.shortcodeType !== 'till' || v.tillNumber, {
    error: 'Enter the till number customers pay to',
    path: ['tillNumber'],
  });

/** A sale paid by an M-Pesa prompt to the customer's phone. */
export const mpesaSaleSchema = z.object({
  litres: litresField(),
  productId: optionalField(id),
  /** Owner-only override, as for any sale. */
  pricePerLitre: optionalField(kesField('Price per litre')),
  customerId: optionalField(id),
  phone: requiredPhone,
  note: optionalText(),
});

/** A customer paying down their deni by an M-Pesa prompt. */
export const mpesaCustomerPaymentSchema = z.object({
  customerId: id,
  amount: kesField(),
  phone: requiredPhone,
});

export const mpesaRequestIdSchema = z.object({ requestId: id });

// Till / paybill reconciliation (C2B)
export const connectTillSchema = z.object({});
export const simulateTillPaymentSchema = z.object({ amount: kesField(), phone: requiredPhone });
export const c2bToCustomerSchema = z.object({ c2bId: id, customerId: id });
export const c2bToSaleSchema = z.object({ c2bId: id, entryId: id });
export const c2bIgnoreSchema = z.object({
  c2bId: id,
  note: z.string().trim().min(3, 'Say what it was, e.g. "Personal transfer"').max(200),
});

// --- shift close ------------------------------------------------------------------

const countField = (label: string) => scaledField(kesToCents, label, { allowZero: true });

/** The seller's blind count at the end of a shift. */
export const shiftCloseSchema = z.object({
  openingFloat: optionalField(countField('Opening float')),
  countedCash: countField('Cash counted'),
  countedMpesa: countField('M-Pesa received'),
  countedMilk: scaledField(litresToMl, 'Milk left', { allowZero: true }),
  note: optionalText(),
});

export const reviewShiftCloseSchema = z.object({
  closeId: id,
  writeOffShortfall: z.boolean(),
  note: optionalText(200),
});

// --- products ------------------------------------------------------------------

export const PRODUCT_UNITS = ['piece', 'litre', 'kg'] as const;

export const productSchema = z.object({
  name: z.string().trim().min(2, 'Enter a name').max(80),
  unit: z.enum(PRODUCT_UNITS),
  salePrice: optionalField(kesFieldAllowZero('Selling price')),
  costPrice: optionalField(kesFieldAllowZero('Buying price')),
  /** In the product's unit; warns when stock falls to it. */
  reorderLevel: optionalField(scaledField(litresToMl, 'Reorder level', { allowZero: true })),
});

export const updateProductSchema = productSchema.extend({ productId: id });
export const archiveProductSchema = z.object({ productId: id, archived: z.boolean() });

// --- supplier-recorded deliveries ---------------------------------------------

/** A supplier records what they delivered: litres only, dated today by the server. */
export const submitDeliverySchema = z.object({
  litres: litresField(),
  note: optionalText(),
});

/** The seller's decision on a supplier's delivery. Rejecting needs a reason. */
export const reviewDeliverySchema = z
  .object({
    submissionId: id,
    decision: z.enum(['approve', 'reject']),
    reason: optionalText(200),
  })
  .refine((v) => v.decision !== 'reject' || v.reason, {
    error: 'Say what was wrong, e.g. "Only 38 L arrived"',
    path: ['reason'],
  });

export const customerPaymentSchema = z.object({
  customerId: id,
  amount: kesField(),
  paymentMethod: z.enum(IMMEDIATE_PAYMENT_METHODS),
  date: entryDate,
  note: optionalText(),
});

export const supplierPaymentSchema = z.object({
  supplierId: id,
  amount: kesField(),
  paymentMethod: z.enum(IMMEDIATE_PAYMENT_METHODS),
  date: entryDate,
  note: optionalText(),
});

export const expenseSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES),
  amount: kesField(),
  /** How it was paid: decides whether the shift's cash or M-Pesa goes down. */
  paymentMethod: optionalField(z.enum(IMMEDIATE_PAYMENT_METHODS)),
  date: entryDate,
  note: optionalText(),
});

export const spoilageSchema = z.object({
  /** Blank = fresh milk. */
  productId: optionalField(id),
  litres: litresField(),
  reason: z.enum(SPOILAGE_REASONS),
  date: entryDate,
  note: optionalText(),
});

export const reverseEntrySchema = z.object({
  entryId: id,
  reason: z.string().trim().min(3, 'Say why this entry is being reversed').max(500),
});

// --- master data ------------------------------------------------------------

export const customerSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(120),
  phone: phoneField,
  address: optionalText(200),
  /** Blank = no limit. */
  creditLimit: optionalField(kesFieldAllowZero('Credit limit')),
});

export const supplierSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(120),
  phone: phoneField,
  defaultPricePerLitre: optionalField(kesFieldAllowZero('Default price')),
});

export const updateCustomerSchema = customerSchema.extend({ customerId: id });

export const updateSupplierSchema = supplierSchema.extend({ supplierId: id });

/** The shop's selling price per litre (owner only). */
export const salePriceSchema = z.object({
  pricePerLitre: kesField('Selling price'),
});

export const subscriptionSchema = z.object({
  customerId: id,
  dailyLitres: litresField('Daily litres'),
  pricePerLitre: kesField('Price per litre'),
  startDate: isoDate,
});

export const subscriptionStatusSchema = z.object({
  subscriptionId: id,
  status: z.enum(['active', 'paused', 'cancelled']),
});

export const billSubscriptionsSchema = z.object({
  date: entryDate,
});

// --- auth -------------------------------------------------------------------

/** Trimmed, lower-cased email (the sign-in identifier). */
export const emailField = z
  .string({ error: 'Email is required' })
  .trim()
  .toLowerCase()
  .min(1, 'Email is required')
  .max(254)
  .pipe(z.email({ error: 'Enter a valid email address' }));

export const PASSWORD_MIN = 10;

export const newPasswordField = z
  .string({ error: 'Password is required' })
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters`)
  .max(200, 'That password is too long');

/** 6-digit one-time code; spaces and dashes are ignored ("123 456"). */
export const codeField = z
  .string({ error: 'Enter the 6-digit code' })
  .transform((v) => v.replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'));

const personName = z.string().trim().min(2, 'Enter your name').max(120);
const shopName = z.string().trim().min(2, 'Enter your shop name').max(120);

export const passwordLoginSchema = z.object({
  email: emailField,
  password: z.string().min(1, 'Password is required').max(200),
});

export const codeLoginSchema = z.object({ email: emailField, code: codeField });

export const requestCodeSchema = z.object({ email: emailField });

export const signupSchema = z.object({
  shopName,
  name: personName,
  email: emailField,
  password: newPasswordField,
});

export const forgotPasswordSchema = z.object({ email: emailField });

export const resetPasswordSchema = z
  .object({
    token: z.string().min(20, 'This reset link is invalid').max(200),
    password: newPasswordField,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    error: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().max(200),
    password: newPasswordField,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    error: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const requestEmailChangeSchema = z.object({ email: emailField });
export const confirmEmailChangeSchema = z.object({ email: emailField, code: codeField });

export const profileSchema = z.object({ name: personName });
export const shopSchema = z.object({ name: shopName });

export const inviteStaffSchema = z.object({
  name: personName,
  email: emailField,
  role: z.enum(['owner', 'attendant']),
});

export const userActiveSchema = z.object({
  userId: id,
  active: z.boolean(),
});

export const userRoleSchema = z.object({
  userId: id,
  role: z.enum(['owner', 'attendant']),
});

export const resendInviteSchema = z.object({ userId: id });

/** Give a supplier (milkman) their own login, to record their deliveries. */
export const inviteSupplierSchema = z.object({
  supplierId: id,
  name: personName,
  email: emailField,
});

// --- reports --------------------------------------------------------------------

export const REPORT_TYPES = [
  'profit',
  'sales',
  'deliveries',
  'approvals',
  'debtors',
  'suppliers',
  'expenses',
  'staff',
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export type SaleInput = z.output<typeof saleSchema>;
export type DeliveryInput = z.output<typeof deliverySchema>;
export type CustomerPaymentInput = z.output<typeof customerPaymentSchema>;
export type SupplierPaymentInput = z.output<typeof supplierPaymentSchema>;
export type ExpenseInput = z.output<typeof expenseSchema>;
export type SpoilageInput = z.output<typeof spoilageSchema>;
export type CustomerInput = z.output<typeof customerSchema>;
export type SupplierInput = z.output<typeof supplierSchema>;
export type UpdateCustomerInput = z.output<typeof updateCustomerSchema>;
export type UpdateSupplierInput = z.output<typeof updateSupplierSchema>;
export type SubscriptionInput = z.output<typeof subscriptionSchema>;
export type SignupInput = z.output<typeof signupSchema>;
export type InviteStaffInput = z.output<typeof inviteStaffSchema>;
export type InviteSupplierInput = z.output<typeof inviteSupplierSchema>;
export type PaySuppliersInput = z.output<typeof paySuppliersSchema>;
export type BudgetsInput = z.output<typeof budgetsSchema>;
export type EmployeeInput = z.output<typeof employeeSchema>;
export type UpdateEmployeeInput = z.output<typeof updateEmployeeSchema>;
export type AttendanceInput = z.output<typeof attendanceSchema>;
export type AdvanceInput = z.output<typeof advanceSchema>;
export type RemitStatutoryInput = z.output<typeof remitStatutorySchema>;
export type PostPayrollInput = z.output<typeof postPayrollSchema>;
export type MpesaSettingsInput = z.output<typeof mpesaSettingsSchema>;
export type MpesaSaleInput = z.output<typeof mpesaSaleSchema>;
export type MpesaCustomerPaymentInput = z.output<typeof mpesaCustomerPaymentSchema>;
export type ShiftCloseInput = z.output<typeof shiftCloseSchema>;
export type ReviewShiftCloseInput = z.output<typeof reviewShiftCloseSchema>;
export type ProductInput = z.output<typeof productSchema>;
export type UpdateProductInput = z.output<typeof updateProductSchema>;
export type SubmitDeliveryInput = z.output<typeof submitDeliverySchema>;
export type ReviewDeliveryInput = z.output<typeof reviewDeliverySchema>;
