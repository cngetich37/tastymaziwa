import { describe, expect, it } from 'vitest';
import { computePay } from './payroll';

const nov = { from: '2026-11-01', lastDay: '2026-11-30' };

describe('computePay', () => {
  it('pays daily workers for the days they worked, less advances', () => {
    expect(computePay({ payType: 'daily', rateCents: 50_000, startDate: '2026-01-01', daysWorked: 12, advancesCents: 100_000 }, nov)).toMatchObject({
      daysWorked: 12,
      grossCents: 600_000,
      advancesCents: 100_000,
      netCents: 500_000,
      carryForwardCents: 0,
    });
  });

  it('pays monthly staff their salary, prorated from a mid-month start', () => {
    expect(computePay({ payType: 'monthly', rateCents: 1_500_000, startDate: '2025-06-01', daysWorked: 3, advancesCents: 0 }, nov).grossCents).toBe(
      1_500_000,
    );
    // Started on the 16th: 15 of 30 days.
    expect(computePay({ payType: 'monthly', rateCents: 1_500_000, startDate: '2026-11-16', daysWorked: 0, advancesCents: 0 }, nov).grossCents).toBe(
      750_000,
    );
    expect(computePay({ payType: 'monthly', rateCents: 1_500_000, startDate: '2026-12-01', daysWorked: 0, advancesCents: 0 }, nov).grossCents).toBe(0);
  });

  it('carries forward advances bigger than the pay', () => {
    expect(computePay({ payType: 'daily', rateCents: 50_000, startDate: '2026-01-01', daysWorked: 2, advancesCents: 150_000 }, nov)).toMatchObject({
      grossCents: 100_000,
      advancesCents: 100_000,
      netCents: 0,
      carryForwardCents: 50_000,
    });
  });
});

describe('statutory deductions in pay', () => {
  it('takes NSSF, SHIF, housing levy and PAYE off gross, then advances', () => {
    const line = computePay(
      { payType: 'monthly', rateCents: 10_000_000, startDate: '2025-01-01', daysWorked: 0, advancesCents: 500_000, statutory: true },
      nov,
    );
    expect(line).toMatchObject({ grossCents: 10_000_000, nssfCents: 600_000, payeCents: 1_930_835, advancesCents: 500_000 });
    expect(line.netCents).toBe(10_000_000 - 600_000 - 275_000 - 150_000 - 1_930_835 - 500_000);
  });

  it('leaves casual workers without statutory deductions unless marked', () => {
    const line = computePay({ payType: 'daily', rateCents: 50_000, startDate: '2026-01-01', daysWorked: 10, advancesCents: 0 }, nov);
    expect(line).toMatchObject({ grossCents: 500_000, employeeTotalCents: 0, netCents: 500_000 });
  });
});
