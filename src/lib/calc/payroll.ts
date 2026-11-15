/**
 * Monthly payroll maths. Pure, so it is unit-tested.
 *
 * - Daily workers earn their rate for each day marked present in the month.
 * - Monthly staff earn their salary, prorated by calendar day if they
 *   started during the month.
 * - Formally employed staff (`statutory`) have NSSF, SHIF, the housing levy
 *   and PAYE taken off gross first (see ./statutory).
 * - Unsettled advances come off what is left. If they exceed it, net pay is
 *   zero and the rest carries forward to next month.
 */
import { daysBetween, type BusinessDate } from '@/lib/dates';
import { NO_STATUTORY, statutoryDeductions, type Statutory } from './statutory';

export interface PayInput {
  payType: 'daily' | 'monthly';
  rateCents: number;
  startDate: BusinessDate;
  daysWorked: number;
  advancesCents: number;
  /** NSSF, SHIF, housing levy and PAYE apply. */
  statutory?: boolean;
}

export interface PayLine extends Statutory {
  daysWorked: number;
  grossCents: number;
  /** Advances taken off this month's pay. */
  advancesCents: number;
  netCents: number;
  /** Advances (or deductions) still owed after this payroll. */
  carryForwardCents: number;
}

export function grossPay(input: PayInput, month: { from: BusinessDate; lastDay: BusinessDate }): number {
  if (input.payType === 'daily') return input.daysWorked * input.rateCents;
  if (input.startDate > month.lastDay) return 0;
  if (input.startDate > month.from) {
    const daysInMonth = daysBetween(month.from, month.lastDay) + 1;
    const daysEmployed = daysBetween(input.startDate, month.lastDay) + 1;
    return Math.round((input.rateCents * daysEmployed) / daysInMonth);
  }
  return input.rateCents;
}

export function computePay(input: PayInput, month: { from: BusinessDate; lastDay: BusinessDate }): PayLine {
  const grossCents = grossPay(input, month);
  const statutory = input.statutory ? statutoryDeductions(grossCents, month.from.slice(0, 7)) : { ...NO_STATUTORY };
  // After statutory deductions; negative only in the odd case they exceed tiny pay.
  const available = grossCents - statutory.employeeTotalCents;
  const advancesCents = Math.min(input.advancesCents, Math.max(0, available));
  return {
    ...statutory,
    daysWorked: input.daysWorked,
    grossCents,
    advancesCents,
    netCents: Math.max(0, available - advancesCents),
    carryForwardCents: input.advancesCents - advancesCents + Math.max(0, -available),
  };
}
