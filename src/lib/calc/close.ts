/**
 * Cash-up maths for the end-of-shift close. Pure, so it is unit-tested.
 * Money in: cash/M-Pesa sales and customer payments. Money out: supplier
 * payments and expenses paid the same way. Credit sales move no money.
 * Reversals carry negated amounts, so they net out automatically.
 */
import type { EntryKind, PaymentMethod } from './summary';

export interface MoneyRow {
  kind: EntryKind;
  paymentMethod: PaymentMethod | null;
  amountCents: number;
}

const DIRECTION: Partial<Record<EntryKind, 1 | -1>> = {
  sale: 1,
  customer_payment: 1,
  supplier_payment: -1,
  expense: -1,
};

/** Net cash and M-Pesa the shift should have taken. Expenses without a method count as cash. */
export function expectedTakings(rows: Iterable<MoneyRow>): { cashCents: number; mpesaCents: number } {
  let cashCents = 0;
  let mpesaCents = 0;
  for (const row of rows) {
    const dir = DIRECTION[row.kind];
    if (!dir) continue;
    const method = row.paymentMethod ?? (row.kind === 'expense' ? 'cash' : null);
    if (method === 'cash') cashCents += dir * row.amountCents;
    else if (method === 'mpesa') mpesaCents += dir * row.amountCents;
  }
  return { cashCents, mpesaCents };
}

export interface CloseFigures {
  expectedCashCents: number;
  countedCashCents: number;
  expectedMpesaCents: number;
  countedMpesaCents: number;
  expectedMilkMl: number;
  countedMilkMl: number;
}

/** Counted minus expected: negative is a shortfall, positive an overage. */
export function closeVariance(c: CloseFigures) {
  return {
    cashCents: c.countedCashCents - c.expectedCashCents,
    mpesaCents: c.countedMpesaCents - c.expectedMpesaCents,
    milkMl: c.countedMilkMl - c.expectedMilkMl,
  };
}

/** Small differences are normal (change, a splash of milk); flag anything bigger. */
export const TOLERANCE = { cashCents: 5000, mpesaCents: 0, milkMl: 500 } as const;

export function isBalanced(c: CloseFigures): boolean {
  const v = closeVariance(c);
  return (
    Math.abs(v.cashCents) <= TOLERANCE.cashCents &&
    Math.abs(v.mpesaCents) <= TOLERANCE.mpesaCents &&
    Math.abs(v.milkMl) <= TOLERANCE.milkMl
  );
}
