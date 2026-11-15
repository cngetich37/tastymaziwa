import { describe, expect, it } from 'vitest';
import {
  MAX_RANGE_DAYS,
  ageBucket,
  ageingByCustomer,
  csvValue,
  marginPerLitreCents,
  perLitreCents,
  resolveRange,
  toCsv,
} from './reports';

const today = '2026-11-15';

describe('resolveRange', () => {
  it('defaults to this month', () => {
    expect(resolveRange({}, today)).toMatchObject({ from: '2026-11-01', to: today, preset: 'month' });
    expect(resolveRange({ range: 'nonsense' }, today).preset).toBe('month');
  });

  it('resolves presets', () => {
    expect(resolveRange({ range: 'today' }, today)).toMatchObject({ from: today, to: today });
    expect(resolveRange({ range: 'yesterday' }, today)).toMatchObject({ from: '2026-11-14', to: '2026-11-14' });
    expect(resolveRange({ range: '7d' }, today)).toMatchObject({ from: '2026-11-09', to: today });
    expect(resolveRange({ range: '30d' }, today)).toMatchObject({ from: '2026-10-17', to: today });
  });

  it('finds last month across a year boundary', () => {
    expect(resolveRange({ range: 'last-month' }, '2027-01-10')).toMatchObject({ from: '2026-12-01', to: '2026-12-31' });
    expect(resolveRange({ range: 'last-month' }, '2028-03-31')).toMatchObject({ from: '2028-02-01', to: '2028-02-29' });
  });

  it('takes custom dates, swapping, clamping and capping them', () => {
    expect(resolveRange({ from: '2026-11-03', to: '2026-11-05' }, today)).toMatchObject({
      from: '2026-11-03',
      to: '2026-11-05',
      preset: 'custom',
    });
    expect(resolveRange({ from: '2026-11-05', to: '2026-11-03' }, today)).toMatchObject({ from: '2026-11-03', to: '2026-11-05' });
    expect(resolveRange({ from: '2026-11-10', to: '2027-01-01' }, today)).toMatchObject({ from: '2026-11-10', to: today });
    expect(resolveRange({ from: '2026-11-10' }, today)).toMatchObject({ from: '2026-11-10', to: today });
    const long = resolveRange({ from: '2020-01-01', to: today }, today);
    expect(long.to).toBe(today);
    expect(long.from).toBe('2025-11-15');
    expect(MAX_RANGE_DAYS).toBe(366);
  });

  it('ignores impossible dates', () => {
    expect(resolveRange({ from: '2026-02-30', to: 'x' }, today).preset).toBe('month');
  });
});

describe('credit ageing', () => {
  it('buckets by days overdue', () => {
    expect([0, -3, 1, 7, 8, 30, 31].map(ageBucket)).toEqual([
      'current',
      'current',
      'd1_7',
      'd1_7',
      'd8_30',
      'd8_30',
      'd30_plus',
    ]);
  });

  it('totals per customer, most overdue first', () => {
    const rows = ageingByCustomer([
      { customerId: 'a', customerName: 'Amina', businessDate: '2026-11-10', outstandingCents: 5000, daysOverdue: 0 },
      { customerId: 'b', customerName: 'Baraka', businessDate: '2026-10-01', outstandingCents: 2000, daysOverdue: 38 },
      { customerId: 'a', customerName: 'Amina', businessDate: '2026-11-01', outstandingCents: 3000, daysOverdue: 7 },
      { customerId: 'b', customerName: 'Baraka', businessDate: '2026-11-12', outstandingCents: 0, daysOverdue: 0 },
    ]);
    expect(rows.map((r) => r.customerId)).toEqual(['b', 'a']);
    expect(rows[1]).toMatchObject({ totalCents: 8000, current: 5000, d1_7: 3000, oldestDate: '2026-11-01', maxDaysOverdue: 7 });
    expect(rows[0]).toMatchObject({ totalCents: 2000, d30_plus: 2000 });
  });
});

describe('margin per litre', () => {
  it('is average selling price minus average buying price', () => {
    // Sold 10 L for 700, bought 12 L for 600: 70/L − 50/L = 20/L.
    expect(marginPerLitreCents({ salesCents: 70_000, salesMl: 10_000, deliveryCostCents: 60_000, deliveredMl: 12_000 })).toBe(
      2000,
    );
  });

  it('is unknown without both sales and deliveries', () => {
    expect(marginPerLitreCents({ salesCents: 100, salesMl: 1000, deliveryCostCents: 0, deliveredMl: 0 })).toBeNull();
    expect(perLitreCents(0, 0)).toBeNull();
    expect(perLitreCents(1000, 3000)).toBe(333);
  });
});

describe('CSV', () => {
  it('writes plain numbers and escapes text', () => {
    expect(csvValue(123_450, 'kes')).toBe('1234.50');
    expect(csvValue(2500, 'litres')).toBe('2.5');
    expect(csvValue(null, 'text')).toBe('');
    const csv = toCsv({
      title: 't',
      columns: [
        { key: 'name', label: 'Customer', type: 'text' },
        { key: 'owed', label: 'Owed', type: 'kes' },
      ],
      rows: [
        { name: 'Mama "Njeri", Kawangware', owed: 85_000 },
        { name: '=HYPERLINK("x")', owed: -500 },
      ],
      totals: { name: 'Total', owed: 84_500 },
    });
    expect(csv).toBe(
      'Customer,Owed (KES)\r\n"Mama ""Njeri"", Kawangware",850.00\r\n"\'=HYPERLINK(""x"")",-5.00\r\nTotal,845.00\r\n',
    );
  });
});
