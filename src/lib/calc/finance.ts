/** Budgets, credit limits and month ranges: pure, unit-tested. */
import { addDays, type BusinessDate } from '@/lib/dates';

export type BudgetState = 'none' | 'ok' | 'near' | 'over';

/** "near" from 80% of the budget; "over" once spending passes it. */
export function budgetStatus(spentCents: number, budgetCents: number | null) {
  if (budgetCents == null) return { state: 'none' as BudgetState, remainingCents: null, percent: null };
  const percent = budgetCents === 0 ? (spentCents > 0 ? 100 : 0) : Math.round((spentCents / budgetCents) * 100);
  const state: BudgetState = spentCents > budgetCents ? 'over' : percent >= 80 ? 'near' : 'ok';
  return { state, remainingCents: budgetCents - spentCents, percent };
}

/** Whether a new credit sale takes the customer past their limit (null = no limit). */
export function overCreditLimit(balanceCents: number, saleCents: number, limitCents: number | null): boolean {
  return limitCents != null && balanceCents + saleCents > limitCents;
}

/** A `?month=YYYY-MM` parameter as a date range, never past today; defaults to this month. */
export function monthRange(month: unknown, today: BusinessDate) {
  const valid = typeof month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && month <= today.slice(0, 7);
  const m = valid ? month : today.slice(0, 7);
  const from = `${m}-01`;
  const [y, mm] = m.split('-').map(Number);
  const next = mm === 12 ? `${y + 1}-01-01` : `${y}-${String(mm + 1).padStart(2, '0')}-01`;
  const lastDay = addDays(next, -1);
  return { month: m, from, to: lastDay < today ? lastDay : today, lastDay };
}

/** The month before / after `YYYY-MM`. */
export function shiftMonth(month: string, by: -1 | 1): string {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + (m - 1) + by;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}
