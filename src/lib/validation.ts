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
    pricePerLitre: kesField('Price per litre'),
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
  pricePerLitre: kesFieldAllowZero('Price per litre'),
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

export const loginSchema = z.object({
  username: z.string().trim().toLowerCase().min(1, 'Username is required').max(64),
  password: z.string().min(1, 'Password is required').max(200),
});

export const newUserSchema = z.object({
  name: z.string().trim().min(2).max(120),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,32}$/, '3–32 characters: letters, numbers, . _ -'),
  password: z.string().min(10, 'Use at least 10 characters').max(200),
  role: z.enum(['owner', 'attendant']),
});

export type SaleInput = z.output<typeof saleSchema>;
export type DeliveryInput = z.output<typeof deliverySchema>;
export type CustomerPaymentInput = z.output<typeof customerPaymentSchema>;
export type SupplierPaymentInput = z.output<typeof supplierPaymentSchema>;
export type ExpenseInput = z.output<typeof expenseSchema>;
export type SpoilageInput = z.output<typeof spoilageSchema>;
export type CustomerInput = z.output<typeof customerSchema>;
export type SupplierInput = z.output<typeof supplierSchema>;
export type SubscriptionInput = z.output<typeof subscriptionSchema>;
export type NewUserInput = z.output<typeof newUserSchema>;
