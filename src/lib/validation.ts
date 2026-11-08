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
  litres: litresField(),
  /** Owner-only override; blank means the supplier's agreed price. */
  pricePerLitre: optionalField(kesFieldAllowZero('Price per litre')),
  date: entryDate,
  note: optionalText(),
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
  date: entryDate,
  note: optionalText(),
});

export const spoilageSchema = z.object({
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
