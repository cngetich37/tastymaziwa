import { describe, expect, it } from 'vitest';
import { computePay } from './payroll';

const nov = { from: '2026-11-01', lastDay: '2026-11-30' };

describe('computePay', () => {
  it('pays daily workers for the days they worked, less advances', () => {
    expect(computePay({ payType: 'daily', rateCents: 50_000, startDate: '2026-01-01', daysWorked: 12, advancesCents: 100_000 }, nov)).toEqual({
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
