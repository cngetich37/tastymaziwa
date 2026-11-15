import { describe, expect, it } from 'vitest';
import { closeVariance, expectedTakings, isBalanced } from './close';

describe('expectedTakings', () => {
  it('nets money in and out per method, ignoring credit and stock', () => {
    expect(
      expectedTakings([
        { kind: 'sale', paymentMethod: 'cash', amountCents: 10_000 },
        { kind: 'sale', paymentMethod: 'mpesa', amountCents: 7000 },
        { kind: 'sale', paymentMethod: 'credit', amountCents: 5000 },
        { kind: 'customer_payment', paymentMethod: 'cash', amountCents: 2000 },
        { kind: 'supplier_payment', paymentMethod: 'cash', amountCents: 3000 },
        { kind: 'supplier_payment', paymentMethod: 'mpesa', amountCents: 1000 },
        { kind: 'expense', paymentMethod: null, amountCents: 500 },
        { kind: 'delivery', paymentMethod: null, amountCents: 99_999 },
        // A reversed cash sale nets out.
        { kind: 'sale', paymentMethod: 'cash', amountCents: -1000 },
      ]),
    ).toEqual({ cashCents: 7500, mpesaCents: 6000 });
  });
});

describe('variance', () => {
  const close = {
    expectedCashCents: 10_000,
    countedCashCents: 9000,
    expectedMpesaCents: 5000,
    countedMpesaCents: 5000,
    expectedMilkMl: 20_000,
    countedMilkMl: 20_300,
  };

  it('is counted minus expected', () => {
    expect(closeVariance(close)).toEqual({ cashCents: -1000, mpesaCents: 0, milkMl: 300 });
  });

  it('tolerates small differences only', () => {
    expect(isBalanced(close)).toBe(true);
    expect(isBalanced({ ...close, countedCashCents: 4000 })).toBe(false);
    expect(isBalanced({ ...close, countedMpesaCents: 4900 })).toBe(false);
    expect(isBalanced({ ...close, countedMilkMl: 18_000 })).toBe(false);
  });
});
