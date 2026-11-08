import { describe, expect, it } from 'vitest';
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
    expect(result.error?.flatten().fieldErrors.customerId).toBeDefined();
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
