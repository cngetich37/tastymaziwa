import { describe, expect, it } from 'vitest';
import { SHEET_B_HEADERS, kraAmount, p9Row, p9Totals, sheetBRow, toSheetBCsv } from './kra';
import { statutoryDeductions } from './statutory';

const month = '2026-11';
const lineFor = (grossCents: number) => ({ grossCents, ...statutoryDeductions(grossCents, month) });

describe('P9A row', () => {
  it('fills the KRA columns for the KES 100,000 example', () => {
    expect(p9Row(lineFor(10_000_000))).toEqual({
      basicCents: 10_000_000,
      benefitsCents: 0,
      quartersCents: 0,
      grossCents: 10_000_000,
      e1Cents: 3_000_000,
      e2Cents: 600_000,
      e3Cents: 3_000_000,
      housingLevyCents: 150_000,
      shifCents: 275_000,
      prmfCents: 0,
      mortgageInterestCents: 0,
      deductionsCents: 1_025_000,
      chargeableCents: 8_975_000,
      taxChargedCents: 2_170_835,
      personalReliefCents: 240_000,
      insuranceReliefCents: 0,
      payeCents: 1_930_835,
    });
  });

  it('keeps O = L − M for every pay level that pays tax', () => {
    for (const gross of [3_000_000, 5_000_000, 25_000_000, 90_000_000]) {
      const r = p9Row(lineFor(gross));
      expect(r.chargeableCents).toBe(r.grossCents - r.deductionsCents);
      expect(r.payeCents).toBe(Math.max(0, r.taxChargedCents - r.personalReliefCents));
    }
  });

  it('totals a year column by column', () => {
    const t = p9Totals([p9Row(lineFor(10_000_000)), p9Row(lineFor(10_000_000))]);
    expect(t).toMatchObject({ grossCents: 20_000_000, payeCents: 3_861_670, chargeableCents: 17_950_000 });
  });
});

describe('iTax Sheet B', () => {
  it('has the template’s 25 columns, in order', () => {
    const row = sheetBRow({ kraPin: 'A123456789B', name: 'Wanjiku Kamau' }, lineFor(10_000_000));
    expect(row).toHaveLength(SHEET_B_HEADERS.length);
    expect(SHEET_B_HEADERS).toHaveLength(25);
    expect(row).toEqual([
      'A123456789B',
      'Wanjiku Kamau',
      'Resident',
      'Primary Employee',
      'No',
      '',
      '100000.00',
      '0.00',
      '0.00',
      '0.00',
      'Benefit not given',
      '0.00',
      '0.00',
      '100000.00',
      '2750.00',
      '6000.00',
      '0.00',
      '0.00',
      '0.00',
      '1500.00',
      '89750.00',
      '2400.00',
      '0.00',
      '19308.35',
      '19308.35',
    ]);
  });

  it('writes CSV rows without a header, quoting names with commas', () => {
    expect(kraAmount(123_456)).toBe('1234.56');
    const csv = toSheetBCsv([['A1', 'Kamau, Jane', '1.00']]);
    expect(csv).toBe('A1,"Kamau, Jane",1.00\r\n');
  });
});
