import { describe, expect, it } from 'vitest';
import { budgetStatus, monthRange, overCreditLimit, shiftMonth } from './finance';
import { statementForPeriod, withRunningBalance } from './statement';

describe('budgetStatus', () => {
  it('tracks spending against the budget', () => {
    expect(budgetStatus(5000, null).state).toBe('none');
    expect(budgetStatus(5000, 10_000)).toEqual({ state: 'ok', remainingCents: 5000, percent: 50 });
    expect(budgetStatus(8000, 10_000).state).toBe('near');
    expect(budgetStatus(10_000, 10_000).state).toBe('near');
    expect(budgetStatus(10_001, 10_000)).toMatchObject({ state: 'over', remainingCents: -1 });
    expect(budgetStatus(1, 0).state).toBe('over');
  });
});

describe('overCreditLimit', () => {
  it('only blocks past a set limit', () => {
    expect(overCreditLimit(90_000, 10_000, 100_000)).toBe(false);
    expect(overCreditLimit(90_000, 10_001, 100_000)).toBe(true);
    expect(overCreditLimit(1_000_000, 1, null)).toBe(false);
  });
});

describe('months', () => {
  it('turns a month into a range that stops today', () => {
    expect(monthRange('2026-02', '2026-11-15')).toEqual({ month: '2026-02', from: '2026-02-01', to: '2026-02-28', lastDay: '2026-02-28' });
    expect(monthRange('2026-11', '2026-11-15')).toMatchObject({ from: '2026-11-01', to: '2026-11-15', lastDay: '2026-11-30' });
    expect(monthRange('2027-01', '2026-11-15').month).toBe('2026-11');
    expect(monthRange('nope', '2026-11-15').month).toBe('2026-11');
  });

  it('steps across years', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
  });
});

describe('statementForPeriod', () => {
  it('brings the balance forward and carries it out', () => {
    const rows = withRunningBalance(
      [
        { businessDate: '2026-10-30', kind: 'sale', paymentMethod: 'credit', amountCents: 10_000 },
        { businessDate: '2026-11-02', kind: 'sale', paymentMethod: 'credit', amountCents: 5000 },
        { businessDate: '2026-11-03', kind: 'sale', paymentMethod: 'cash', amountCents: 999 },
        { businessDate: '2026-11-05', kind: 'customer_payment', paymentMethod: 'mpesa', amountCents: 8000 },
        { businessDate: '2026-11-20', kind: 'sale', paymentMethod: 'credit', amountCents: 1000 },
      ] as const,
      'customer',
    );
    const s = statementForPeriod(rows, '2026-11-01', '2026-11-15');
    expect(s).toMatchObject({ openingCents: 10_000, chargesCents: 5000, paymentsCents: 8000, closingCents: 7000 });
    expect(s.lines.map((l) => l.businessDate)).toEqual(['2026-11-02', '2026-11-03', '2026-11-05']);
  });
});
