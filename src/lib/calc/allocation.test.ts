import { describe, expect, it } from 'vitest';
import { allocatePayments } from './allocation';

const sales = [
  { id: 'b', businessDate: '2026-11-03', dueDate: '2026-11-10', amountCents: 5000 },
  { id: 'a', businessDate: '2026-11-01', dueDate: '2026-11-08', amountCents: 3000 },
  { id: 'c', businessDate: '2026-11-05', dueDate: null, amountCents: 2000 },
];

describe('allocatePayments', () => {
  it('applies payments oldest sale first', () => {
    const { sales: result } = allocatePayments(sales, 4000);
    expect(result.map((s) => [s.id, s.status, s.outstandingCents])).toEqual([
      ['a', 'paid', 0],
      ['b', 'partial', 4000],
      ['c', 'outstanding', 2000],
    ]);
  });

  it('reports overpayment as unapplied credit', () => {
    const result = allocatePayments(sales, 12_000);
    expect(result.sales.every((s) => s.status === 'paid')).toBe(true);
    expect(result.unappliedCents).toBe(2000);
  });

  it('treats no payments as fully outstanding', () => {
    const result = allocatePayments(sales, 0);
    expect(result.sales.every((s) => s.status === 'outstanding')).toBe(true);
  });

  it('orders same-day sales by time, not by id', () => {
    const sameDay = [
      { id: 'z', businessDate: '2026-11-01', dueDate: null, amountCents: 100, occurredAt: new Date('2026-11-01T06:00:00Z') },
      { id: 'a', businessDate: '2026-11-01', dueDate: null, amountCents: 100, occurredAt: new Date('2026-11-01T09:00:00Z') },
    ];
    const { sales: result } = allocatePayments(sameDay, 100);
    expect(result.find((s) => s.id === 'z')?.status).toBe('paid');
    expect(result.find((s) => s.id === 'a')?.status).toBe('outstanding');
  });

  it('does not mutate its input', () => {
    const copy = structuredClone(sales);
    allocatePayments(sales, 4000);
    expect(sales).toEqual(copy);
  });
});
