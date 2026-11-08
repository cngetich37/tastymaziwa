import { describe, expect, it } from 'vitest';
import { balanceEffectCents, withRunningBalance, type StatementRow } from './statement';

const row = (kind: StatementRow['kind'], amountCents: number, paymentMethod: StatementRow['paymentMethod'] = null) => ({
  kind,
  amountCents,
  paymentMethod,
});

describe('balanceEffectCents', () => {
  it('only credit sales and payments move a customer balance', () => {
    expect(balanceEffectCents(row('sale', 700, 'credit'), 'customer')).toBe(700);
    expect(balanceEffectCents(row('sale', 700, 'cash'), 'customer')).toBe(0);
    expect(balanceEffectCents(row('sale', 700, 'mpesa'), 'customer')).toBe(0);
    expect(balanceEffectCents(row('customer_payment', 500, 'mpesa'), 'customer')).toBe(-500);
  });

  it('deliveries add to and payments reduce a supplier payable', () => {
    expect(balanceEffectCents(row('delivery', 2000), 'supplier')).toBe(2000);
    expect(balanceEffectCents(row('supplier_payment', 1500, 'cash'), 'supplier')).toBe(-1500);
    expect(balanceEffectCents(row('sale', 700, 'credit'), 'supplier')).toBe(0);
  });

  it('reversals (negated rows) cancel their original', () => {
    expect(balanceEffectCents(row('sale', -700, 'credit'), 'customer')).toBe(-700);
    expect(balanceEffectCents(row('delivery', -2000), 'supplier')).toBe(-2000);
  });
});

describe('withRunningBalance', () => {
  it('accumulates oldest first', () => {
    const lines = withRunningBalance(
      [row('sale', 700, 'credit'), row('sale', 350, 'cash'), row('sale', 1400, 'credit'), row('customer_payment', 1000, 'mpesa')],
      'customer',
    );
    expect(lines.map((l) => l.balanceCents)).toEqual([700, 700, 2100, 1100]);
    expect(lines.map((l) => l.effectCents)).toEqual([700, 0, 1400, -1000]);
  });

  it('starts at zero for an empty account', () => {
    expect(withRunningBalance([], 'supplier')).toEqual([]);
  });
});
