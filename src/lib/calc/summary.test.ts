import { describe, expect, it } from 'vitest';
import { customerBalanceCents, dailySeries, summarize, supplierPayableCents, type LedgerRow } from './summary';

const row = (r: Partial<LedgerRow> & Pick<LedgerRow, 'kind'>): LedgerRow => ({
  paymentMethod: null,
  amountCents: 0,
  volumeMl: 0,
  ...r,
});

const day: LedgerRow[] = [
  row({ kind: 'delivery', amountCents: 250_000, volumeMl: 50_000 }), // 50 L @ 50
  row({ kind: 'sale', paymentMethod: 'cash', amountCents: 140_000, volumeMl: 20_000 }),
  row({ kind: 'sale', paymentMethod: 'mpesa', amountCents: 105_000, volumeMl: 15_000 }),
  row({ kind: 'sale', paymentMethod: 'credit', amountCents: 70_000, volumeMl: 10_000 }),
  row({ kind: 'spoilage', volumeMl: 2_000 }),
  row({ kind: 'expense', amountCents: 20_000 }),
  row({ kind: 'customer_payment', paymentMethod: 'mpesa', amountCents: 30_000 }),
  row({ kind: 'supplier_payment', paymentMethod: 'cash', amountCents: 100_000 }),
];

describe('summarize', () => {
  const s = summarize(day);

  it('splits sales by payment method', () => {
    expect(s.salesCents).toBe(315_000);
    expect(s.cashSalesCents).toBe(140_000);
    expect(s.mpesaSalesCents).toBe(105_000);
    expect(s.creditSalesCents).toBe(70_000);
  });

  it('computes gross and net profit', () => {
    expect(s.grossProfitCents).toBe(315_000 - 250_000);
    expect(s.netProfitCents).toBe(315_000 - 250_000 - 20_000);
  });

  it('computes stock movement: delivered − sold − spoiled', () => {
    expect(s.stockChangeMl).toBe(50_000 - 45_000 - 2_000);
  });

  it('nets out reversals', () => {
    const reversed = summarize([
      ...day,
      row({ kind: 'sale', paymentMethod: 'cash', amountCents: -140_000, volumeMl: -20_000 }),
    ]);
    expect(reversed.cashSalesCents).toBe(0);
    expect(reversed.salesMl).toBe(25_000);
  });
});

describe('balances', () => {
  it('customer balance = credit sales − payments', () => {
    expect(customerBalanceCents(day)).toBe(70_000 - 30_000);
  });

  it('cash sales do not affect a customer balance', () => {
    expect(customerBalanceCents([row({ kind: 'sale', paymentMethod: 'cash', amountCents: 5000 })])).toBe(0);
  });

  it('supplier payable = deliveries − payments', () => {
    expect(supplierPayableCents(day)).toBe(150_000);
  });
});

describe('dailySeries', () => {
  it('zero-fills missing days and keeps date order', () => {
    const series = dailySeries(
      ['2026-11-06', '2026-11-07', '2026-11-08'],
      [
        { ...row({ kind: 'sale', paymentMethod: 'cash', amountCents: 1000 }), businessDate: '2026-11-08' },
        { ...row({ kind: 'delivery', amountCents: 400 }), businessDate: '2026-11-06' },
      ],
    );
    expect(series.map((p) => p.grossProfitCents)).toEqual([-400, 0, 1000]);
  });
});
