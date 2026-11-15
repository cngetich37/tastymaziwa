/**
 * Monthly payroll maths. Pure, so it is unit-tested.
 *
 * - Daily workers earn their rate for each day marked present in the month.
 * - Monthly staff earn their salary, prorated by calendar day if they
 *   started during the month.
 * - Unsettled advances are deducted. If they exceed the gross pay, net pay
 *   is zero and the rest carries forward to next month.
 */
import { daysBetween, type BusinessDate } from '@/lib/dates';

export interface PayInput {
  payType: 'daily' | 'monthly';
  rateCents: number;
  startDate: BusinessDate;
  daysWorked: number;
  advancesCents: number;
}

export interface PayLine {
  daysWorked: number;
  grossCents: number;
  /** Advances taken off this month's pay. */
  advancesCents: number;
  netCents: number;
  /** Advances still owed after this payroll. */
  carryForwardCents: number;
}

export function computePay(input: PayInput, month: { from: BusinessDate; lastDay: BusinessDate }): PayLine {
  let grossCents: number;
  if (input.payType === 'daily') {
    grossCents = input.daysWorked * input.rateCents;
  } else if (input.startDate > month.lastDay) {
    grossCents = 0;
  } else if (input.startDate > month.from) {
    const daysInMonth = daysBetween(month.from, month.lastDay) + 1;
    const daysEmployed = daysBetween(input.startDate, month.lastDay) + 1;
    grossCents = Math.round((input.rateCents * daysEmployed) / daysInMonth);
  } else {
    grossCents = input.rateCents;
  }
  const deducted = Math.min(input.advancesCents, grossCents);
  return {
    daysWorked: input.daysWorked,
    grossCents,
    advancesCents: deducted,
    netCents: grossCents - deducted,
    carryForwardCents: input.advancesCents - deducted,
  };
}
