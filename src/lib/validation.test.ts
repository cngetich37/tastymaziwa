import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { customerSchema, normalizeKenyanPhone, saleSchema } from './validation';

describe('normalizeKenyanPhone', () => {
  it.each(['0712345678', '0712 345 678', '712345678', '254712345678', '+254712345678'])(
    'normalises %s',
    (input) => expect(normalizeKenyanPhone(input)).toBe('+254712345678'),
  );

  it('accepts 011x numbers', () => {
    expect(normalizeKenyanPhone('0110123456')).toBe('+254110123456');
  });

  it.each(['12345', '0812345678', '+255712345678'])('rejects %s', (input) => {
    expect(normalizeKenyanPhone(input)).toBeNull();
  });
});

describe('saleSchema', () => {
  const base = { litres: '2.5', pricePerLitre: '70', paymentMethod: 'cash' };

  it('parses strings into millilitres and cents', () => {
    const parsed = saleSchema.parse(base);
    expect(parsed).toMatchObject({ litres: 2500, pricePerLitre: 7000, paymentMethod: 'cash' });
  });

  it('requires a customer for credit sales', () => {
    const result = saleSchema.safeParse({ ...base, paymentMethod: 'credit' });
    expect(result.success).toBe(false);
    expect(z.flattenError(result.error!).fieldErrors.customerId).toBeDefined();
  });

  it('rejects zero, negative and malformed quantities', () => {
    for (const litres of ['0', '-1', 'abc', '']) {
      expect(saleSchema.safeParse({ ...base, litres }).success).toBe(false);
    }
  });

  it('rejects future dates', () => {
    expect(saleSchema.safeParse({ ...base, date: '2999-01-01' }).success).toBe(false);
  });
});

describe('customerSchema', () => {
  it('normalises the phone number and drops empty fields', () => {
    expect(customerSchema.parse({ name: 'Jane', phone: '0712 345 678', address: '' })).toEqual({
      name: 'Jane',
      phone: '+254712345678',
      address: undefined,
    });
  });
});

describe('optional fields (zod 4 semantics)', () => {
  const base = { litres: '2', pricePerLitre: '70', paymentMethod: 'cash' };

  it('accepts missing optional keys', () => {
    expect(saleSchema.parse(base)).toEqual({
      litres: 2000,
      pricePerLitre: 7000,
      paymentMethod: 'cash',
    });
  });

  it('turns blank and whitespace-only strings into undefined', () => {
    const parsed = saleSchema.parse({ ...base, note: '   ', date: '', customerId: '', dueDate: '' });
    expect(parsed.note).toBeUndefined();
    expect(parsed.date).toBeUndefined();
    expect(parsed.customerId).toBeUndefined();
  });

  it('still validates optional fields that are filled in', () => {
    expect(saleSchema.safeParse({ ...base, customerId: 'not-a-uuid' }).success).toBe(false);
    expect(saleSchema.safeParse({ ...base, dueDate: '08/11/2026' }).success).toBe(false);
    expect(customerSchema.safeParse({ name: 'Jane', phone: '12345' }).success).toBe(false);
  });

  it('keeps the custom "required" message for a missing amount', () => {
    const result = saleSchema.safeParse({ pricePerLitre: '70', paymentMethod: 'cash' });
    expect(result.success).toBe(false);
    expect(z.flattenError(result.error!).fieldErrors.litres).toEqual(['Litres is required']);
  });
});
