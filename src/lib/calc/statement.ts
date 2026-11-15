/**
 * Account statements: each line's effect on what is owed, and the running
 * balance after it. Pure, so it is unit-tested; rows come oldest first.
 */
import type { EntryKind, PaymentMethod } from './summary';

export type Party = 'customer' | 'supplier';

export interface StatementRow {
  kind: EntryKind;
  paymentMethod: PaymentMethod | null;
  amountCents: number;
}

/**
 * How much a row changes the balance owed:
 * - customer: credit sales add to what they owe us, payments reduce it;
 *   cash and M-Pesa sales are shown but settle on the spot (0).
 * - supplier: deliveries add to what we owe them, payments reduce it.
 * Reversal rows carry negated amounts, so they cancel their original.
 */
export function balanceEffectCents(row: StatementRow, party: Party): number {
  if (party === 'customer') {
    if (row.kind === 'sale') return row.paymentMethod === 'credit' ? row.amountCents : 0;
    if (row.kind === 'customer_payment') return -row.amountCents;
    return 0;
  }
  if (row.kind === 'delivery') return row.amountCents;
  if (row.kind === 'supplier_payment') return -row.amountCents;
  return 0;
}

export function withRunningBalance<T extends StatementRow>(
  rowsOldestFirst: readonly T[],
  party: Party,
): (T & { effectCents: number; balanceCents: number })[] {
  let balance = 0;
  return rowsOldestFirst.map((row) => {
    const effectCents = balanceEffectCents(row, party);
    balance += effectCents;
    return { ...row, effectCents, balanceCents: balance };
  });
}

export interface PeriodStatement<T> {
  /** Owed before `from`. */
  openingCents: number;
  lines: T[];
  /** Owed at the end of `to`. */
  closingCents: number;
  /** Added to the balance in the period (credit sales / deliveries). */
  chargesCents: number;
  /** Taken off the balance in the period (payments). */
  paymentsCents: number;
}

/**
 * Cut a full running-balance statement (oldest first) down to one period,
 * with the balance brought forward and carried out.
 */
export function statementForPeriod<T extends { businessDate: string; effectCents: number; balanceCents: number }>(
  linesOldestFirst: readonly T[],
  from: string,
  to: string,
): PeriodStatement<T> {
  let openingCents = 0;
  const lines: T[] = [];
  let chargesCents = 0;
  let paymentsCents = 0;
  for (const line of linesOldestFirst) {
    if (line.businessDate < from) openingCents = line.balanceCents;
    else if (line.businessDate <= to) {
      lines.push(line);
      if (line.effectCents > 0) chargesCents += line.effectCents;
      else paymentsCents -= line.effectCents;
    }
  }
  return { openingCents, lines, closingCents: openingCents + chargesCents - paymentsCents, chargesCents, paymentsCents };
}
