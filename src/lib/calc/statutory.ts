/**
 * Kenyan statutory payroll deductions. Pure and unit-tested.
 *
 * Rates as published for 2026 (check KRA / NSSF / SHA notices when they change,
 * and add a row rather than editing an old one, so past payslips stay right):
 * - NSSF (NSSF Act 2013): 6% employee + 6% employer. Tier I on pay up to the
 *   lower earnings limit (LEL), Tier II from the LEL to the upper limit (UEL).
 *   The limits step up each February.
 * - SHIF (Social Health Insurance Act 2023): 2.75% of gross, at least KES 300.
 * - Affordable Housing Levy: 1.5% employee + 1.5% employer.
 * - PAYE: monthly bands on taxable pay (gross less NSSF, SHIF and the housing
 *   levy, which are deductible since December 2024), less personal relief.
 *
 * All amounts are integer cents.
 */

const KES = 100;

/** NSSF limits by the month they took effect (`YYYY-MM`), newest last. */
export const NSSF_SCHEDULE = [
  { from: '2024-02', lelCents: 7_000 * KES, uelCents: 36_000 * KES },
  { from: '2025-02', lelCents: 8_000 * KES, uelCents: 72_000 * KES },
  { from: '2026-02', lelCents: 9_000 * KES, uelCents: 108_000 * KES },
] as const;

export const NSSF_RATE = 0.06;
export const SHIF_RATE = 0.0275;
export const SHIF_MINIMUM_CENTS = 300 * KES;
export const HOUSING_LEVY_RATE = 0.015;
export const PERSONAL_RELIEF_CENTS = 2_400 * KES;
/** NITA (Industrial Training) levy: KES 50 per employee per month, paid by the employer. */
export const NITA_LEVY_CENTS = 50 * KES;
/** P9A column E3: the most pension (NSSF included) deductible per month. */
export const PENSION_CAP_CENTS = 30_000 * KES;

/** Monthly PAYE bands: the rate applies to taxable pay up to `upToCents`. */
export const PAYE_BANDS = [
  { upToCents: 24_000 * KES, rate: 0.1 },
  { upToCents: 32_333 * KES, rate: 0.25 },
  { upToCents: 500_000 * KES, rate: 0.3 },
  { upToCents: 800_000 * KES, rate: 0.325 },
  { upToCents: Infinity, rate: 0.35 },
] as const;

export function nssfLimits(month: string) {
  const row = [...NSSF_SCHEDULE].reverse().find((r) => r.from <= month) ?? NSSF_SCHEDULE[0];
  return { lelCents: row.lelCents, uelCents: row.uelCents };
}

/** Employee NSSF (the employer pays the same): Tier I + Tier II. */
export function nssfCents(grossCents: number, month: string): { tier1: number; tier2: number; total: number } {
  const { lelCents, uelCents } = nssfLimits(month);
  const tier1 = Math.round(Math.min(grossCents, lelCents) * NSSF_RATE);
  const tier2 = Math.round(Math.max(0, Math.min(grossCents, uelCents) - lelCents) * NSSF_RATE);
  return { tier1, tier2, total: tier1 + tier2 };
}

export const shifCents = (grossCents: number) => Math.max(SHIF_MINIMUM_CENTS, Math.round(grossCents * SHIF_RATE));
export const housingLevyCents = (grossCents: number) => Math.round(grossCents * HOUSING_LEVY_RATE);

/** Tax charged on monthly taxable pay, before relief (P9A column L). */
export function taxChargedCents(taxableCents: number): number {
  let tax = 0;
  let lower = 0;
  for (const band of PAYE_BANDS) {
    if (taxableCents <= lower) break;
    tax += (Math.min(taxableCents, band.upToCents) - lower) * band.rate;
    lower = band.upToCents;
  }
  return Math.round(tax);
}

/** Monthly PAYE on taxable pay, after personal relief; never below zero. */
export function payeCents(taxableCents: number): number {
  return Math.max(0, taxChargedCents(taxableCents) - PERSONAL_RELIEF_CENTS);
}

export interface Statutory {
  nssfCents: number;
  shifCents: number;
  housingLevyCents: number;
  /** Gross less NSSF, SHIF and the housing levy. */
  taxableCents: number;
  payeCents: number;
  /** What comes off the employee's pay. */
  employeeTotalCents: number;
  employerNssfCents: number;
  employerHousingLevyCents: number;
  employerNitaCents: number;
}

export const NO_STATUTORY: Statutory = {
  nssfCents: 0,
  shifCents: 0,
  housingLevyCents: 0,
  taxableCents: 0,
  payeCents: 0,
  employeeTotalCents: 0,
  employerNssfCents: 0,
  employerHousingLevyCents: 0,
  employerNitaCents: 0,
};

/** Every statutory amount for one month's gross pay. Zero pay, zero deductions. */
export function statutoryDeductions(grossCents: number, month: string): Statutory {
  if (grossCents <= 0) return { ...NO_STATUTORY };
  const nssf = nssfCents(grossCents, month).total;
  const shif = shifCents(grossCents);
  const levy = housingLevyCents(grossCents);
  const taxable = Math.max(0, grossCents - nssf - shif - levy);
  const paye = payeCents(taxable);
  return {
    nssfCents: nssf,
    shifCents: shif,
    housingLevyCents: levy,
    taxableCents: taxable,
    payeCents: paye,
    employeeTotalCents: nssf + shif + levy + paye,
    employerNssfCents: nssf,
    employerHousingLevyCents: levy,
    employerNitaCents: NITA_LEVY_CENTS,
  };
}
