import { describe, expect, it } from 'vitest';
import { nssfCents, nssfLimits, payeCents, shifCents, statutoryDeductions } from './statutory';

describe('NSSF', () => {
  it('uses the limits in force for the month', () => {
    expect(nssfLimits('2026-01')).toEqual({ lelCents: 800_000, uelCents: 7_200_000 });
    expect(nssfLimits('2026-11')).toEqual({ lelCents: 900_000, uelCents: 10_800_000 });
  });

  it('charges 6% in two tiers, capped at the upper limit', () => {
    expect(nssfCents(500_000, '2026-11')).toEqual({ tier1: 30_000, tier2: 0, total: 30_000 }); // 5,000 → 300
    expect(nssfCents(10_000_000, '2026-11')).toEqual({ tier1: 54_000, tier2: 546_000, total: 600_000 }); // 100k → 6,000
    expect(nssfCents(50_000_000, '2026-11').total).toBe(648_000); // the KES 6,480 maximum
  });
});

describe('SHIF', () => {
  it('is 2.75% with a KES 300 floor', () => {
    expect(shifCents(10_000_000)).toBe(275_000);
    expect(shifCents(500_000)).toBe(30_000);
  });
});

describe('PAYE', () => {
  it('applies the bands then personal relief', () => {
    expect(payeCents(2_000_000)).toBe(0); // 2,000 tax less 2,400 relief
    expect(payeCents(3_000_000)).toBe(150_000); // 2,400 + 1,500 − 2,400 relief
  });

  it('matches the published KES 100,000 example', () => {
    const s = statutoryDeductions(10_000_000, '2026-11');
    expect(s).toMatchObject({
      nssfCents: 600_000,
      shifCents: 275_000,
      housingLevyCents: 150_000,
      taxableCents: 8_975_000,
      payeCents: 1_930_835, // KES 19,308.35
      employerNssfCents: 600_000,
      employerHousingLevyCents: 150_000,
    });
    expect(s.employeeTotalCents).toBe(600_000 + 275_000 + 150_000 + 1_930_835);
  });

  it('leaves low earners with no PAYE and zero pay with nothing', () => {
    const s = statutoryDeductions(1_500_000, '2026-11'); // KES 15,000
    expect(s).toMatchObject({ nssfCents: 90_000, shifCents: 41_250, housingLevyCents: 22_500, payeCents: 0 });
    expect(statutoryDeductions(0, '2026-11').employeeTotalCents).toBe(0);
  });
});
