import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { accountMatches, amountToCents, closestSale, payerMatches, parseTransTime, readMsisdn, type CustomerPhone } from './reconcile';

const customer = (id: string, phone: string): CustomerPhone => ({
  id,
  phone,
  phoneHash: createHash('sha256').update(phone.replace(/^\+/, '')).digest('hex'),
});
const customers = [customer('jane', '+254712345678'), customer('tom', '+254712000678'), customer('amina', '+254799999999')];

describe('reading the payer', () => {
  it('handles plain, hashed and masked numbers', () => {
    expect(readMsisdn('254712345678')).toEqual({ kind: 'phone', phone: '+254712345678' });
    const hash = createHash('sha256').update('254712345678').digest('hex');
    expect(readMsisdn(hash.toUpperCase())).toEqual({ kind: 'hash', hash });
    expect(readMsisdn('2547 ***** 678')).toEqual({ kind: 'masked', prefix: '2547', suffix: '678' });
    expect(readMsisdn('')).toEqual({ kind: 'unknown' });
    expect(readMsisdn('hello')).toEqual({ kind: 'unknown' });
  });

  it('finds the customer by phone, hash or mask', () => {
    expect(payerMatches(readMsisdn('254712345678'), customers)).toEqual(['jane']);
    expect(payerMatches(readMsisdn(createHash('sha256').update('254799999999').digest('hex')), customers)).toEqual(['amina']);
    // A mask can fit more than one customer: the caller must not guess.
    expect(payerMatches(readMsisdn('2547*****678'), customers)).toEqual(['jane', 'tom']);
    expect(payerMatches(readMsisdn('254700000001'), customers)).toEqual([]);
  });

  it('reads a paybill account number as a phone', () => {
    expect(accountMatches('0712 345 678', customers)).toEqual(['jane']);
    expect(accountMatches('254799999999', customers)).toEqual(['amina']);
    expect(accountMatches('INV-22', customers)).toEqual([]);
  });
});

describe('matching a payment to a recorded sale', () => {
  const at = new Date('2026-11-15T07:00:00Z');
  const sales = [
    { id: 'early', amountCents: 14_000, at: new Date('2026-11-15T06:50:00Z') },
    { id: 'close', amountCents: 14_000, at: new Date('2026-11-15T07:02:00Z') },
    { id: 'other-amount', amountCents: 7000, at },
    { id: 'too-late', amountCents: 14_000, at: new Date('2026-11-15T07:30:00Z') },
  ];

  it('takes the closest sale of the same amount within 15 minutes', () => {
    expect(closestSale(14_000, at, sales)?.id).toBe('close');
    expect(closestSale(14_000, at, sales.filter((s) => s.id !== 'close'))?.id).toBe('early');
    expect(closestSale(21_000, at, sales)).toBeNull();
    expect(closestSale(14_000, at, [sales[3]])).toBeNull();
  });
});

describe('Daraja values', () => {
  it('parses Nairobi transaction times and shilling amounts', () => {
    expect(parseTransTime('20261115100000').toISOString()).toBe('2026-11-15T07:00:00.000Z');
    const fallback = new Date('2026-01-01T00:00:00Z');
    expect(parseTransTime('nonsense', fallback)).toBe(fallback);
    expect(amountToCents('1.00')).toBe(100);
    expect(amountToCents(150)).toBe(15_000);
    expect(amountToCents('-5')).toBeNull();
    expect(amountToCents('abc')).toBeNull();
  });
});
