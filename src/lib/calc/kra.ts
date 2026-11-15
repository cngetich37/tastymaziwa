/**
 * KRA documents built from posted payroll lines. Pure and unit-tested.
 *
 * - P9A tax deduction card (KRA template 2025, Appendix 2A): one row per month.
 * - Simplified PAYE return (P10, template v30, from July 2025): Sheet B
 *   "Employee Details", 25 columns, for the template's Import CSV button.
 *
 * The shop pays cash wages only: no car, meals, housing or other benefits, no
 * post-retirement medical fund, mortgage interest or insurance relief, and
 * every employee is treated as a resident primary employee without a PWD
 * exemption. Those columns are zero / defaults.
 */
import { PENSION_CAP_CENTS, PERSONAL_RELIEF_CENTS, taxChargedCents } from './statutory';

export interface PostedLine {
  grossCents: number;
  nssfCents: number;
  shifCents: number;
  housingLevyCents: number;
  taxableCents: number;
  payeCents: number;
}

export interface P9Row {
  /** A Basic salary (all cash pay). */
  basicCents: number;
  /** B Benefits non-cash, C value of quarters. */
  benefitsCents: number;
  quartersCents: number;
  /** D Total gross pay. */
  grossCents: number;
  /** E1 30% of A, E2 actual pension (NSSF), E3 fixed KES 30,000. */
  e1Cents: number;
  e2Cents: number;
  e3Cents: number;
  /** F Affordable housing levy, G SHIF, H post-retirement medical fund, I owner-occupied interest. */
  housingLevyCents: number;
  shifCents: number;
  prmfCents: number;
  mortgageInterestCents: number;
  /** J Total deductions: lower of E, plus F + G + H + I. */
  deductionsCents: number;
  /** K Chargeable pay (D − J). */
  chargeableCents: number;
  /** L Tax charged, M personal relief, N insurance relief, O PAYE tax (L − M − N, not below 0). */
  taxChargedCents: number;
  personalReliefCents: number;
  insuranceReliefCents: number;
  payeCents: number;
}

export function p9Row(line: PostedLine): P9Row {
  const e1 = Math.round(line.grossCents * 0.3);
  const pension = Math.min(e1, line.nssfCents, PENSION_CAP_CENTS);
  const deductions = pension + line.housingLevyCents + line.shifCents;
  const chargeable = Math.max(0, line.grossCents - deductions);
  return {
    basicCents: line.grossCents,
    benefitsCents: 0,
    quartersCents: 0,
    grossCents: line.grossCents,
    e1Cents: e1,
    e2Cents: line.nssfCents,
    e3Cents: PENSION_CAP_CENTS,
    housingLevyCents: line.housingLevyCents,
    shifCents: line.shifCents,
    prmfCents: 0,
    mortgageInterestCents: 0,
    deductionsCents: deductions,
    chargeableCents: chargeable,
    taxChargedCents: taxChargedCents(chargeable),
    personalReliefCents: line.grossCents > 0 ? PERSONAL_RELIEF_CENTS : 0,
    insuranceReliefCents: 0,
    // As deducted at payroll (equals max(0, L − M − N)).
    payeCents: line.payeCents,
  };
}

/** Column-wise totals of a year's P9 rows. */
export function p9Totals(rows: P9Row[]): P9Row {
  const keys = Object.keys(rows[0] ?? p9Row({ grossCents: 0, nssfCents: 0, shifCents: 0, housingLevyCents: 0, taxableCents: 0, payeCents: 0 })) as (keyof P9Row)[];
  return Object.fromEntries(keys.map((k) => [k, rows.reduce((n, r) => n + r[k], 0)])) as unknown as P9Row;
}

// --- iTax simplified PAYE return, Sheet B --------------------------------------------

/** Sheet B headers, in the template's column order (for display; the CSV has no header row). */
export const SHEET_B_HEADERS = [
  'PIN of Employee',
  'Name of Employee',
  'Resident Status',
  'Type of Employee',
  'Persons With Disability (PWD)',
  'Exemption Certificate Number',
  'Total Cash Pay (A)',
  'Value of Car Benefit (B)',
  'Value of Meals (C)',
  'Non Cash Benefits (D)',
  'Type of Housing',
  'Housing Benefit (F)',
  'Other Benefits (G)',
  'Total Gross Pay (H)',
  'Social Health Insurance Fund (SHIF) (I)',
  'NSSF Contribution (J)',
  'Other Pension Contribution (K)',
  'Post Retirement Medical Fund (L)',
  'Mortgage Interest (M)',
  'Affordable Housing Levy (N)',
  'Taxable Pay (O)',
  'Monthly Personal Relief (P)',
  'Amount of Insurance Relief (Q)',
  'PAYE Tax (R)',
  'Self Assessed PAYE Tax (S)',
] as const;

/** KRA amounts: plain decimals with two places, no separators. */
export const kraAmount = (cents: number) => (cents / 100).toFixed(2);

export function sheetBRow(employee: { kraPin: string; name: string }, line: PostedLine): string[] {
  const p9 = p9Row(line);
  const pensionAllowed = Math.min(line.nssfCents, PENSION_CAP_CENTS);
  return [
    employee.kraPin,
    employee.name,
    'Resident',
    'Primary Employee',
    'No',
    '',
    kraAmount(line.grossCents),
    kraAmount(0),
    kraAmount(0),
    kraAmount(0),
    'Benefit not given',
    kraAmount(0),
    kraAmount(0),
    kraAmount(line.grossCents),
    kraAmount(line.shifCents),
    kraAmount(pensionAllowed),
    kraAmount(0),
    kraAmount(0),
    kraAmount(0),
    kraAmount(line.housingLevyCents),
    kraAmount(p9.chargeableCents),
    kraAmount(p9.personalReliefCents),
    kraAmount(0),
    kraAmount(line.payeCents),
    kraAmount(line.payeCents),
  ];
}

const csvCell = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** Rows only, no header: what the template's Import CSV button reads. */
export const toSheetBCsv = (rows: string[][]) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
