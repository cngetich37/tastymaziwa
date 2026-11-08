import { describe, expect, it } from 'vitest';
import {
  centsToKesString,
  formatKES,
  formatLitres,
  kesToCents,
  lineTotalCents,
  litresToMl,
} from './money';

describe('kesToCents', () => {
  it.each([
    ['70', 7000],
    ['70.5', 7050],
    ['70.50', 7050],
    ['0.01', 1],
    [' 1250 ', 125000],
    [70, 7000],
  ])('parses %j → %d', (input, expected) => {
    expect(kesToCents(input)).toBe(expected);
  });

  it('avoids float error (0.1 + 0.2 style inputs)', () => {
    expect(kesToCents('0.29')).toBe(29); // 0.29 * 100 === 28.999999999999996
  });

  it.each(['', 'abc', '1.234', '1,000', '1e3'])('rejects %j', (input) => {
    expect(() => kesToCents(input)).toThrow(RangeError);
  });
});

describe('litresToMl', () => {
  it('handles up to 3 decimal places', () => {
    expect(litresToMl('2.5')).toBe(2500);
    expect(litresToMl('0.250')).toBe(250);
    expect(() => litresToMl('0.2505')).toThrow();
  });
});

describe('lineTotalCents', () => {
  it('multiplies litres by price per litre', () => {
    expect(lineTotalCents(2500, 7000)).toBe(17500); // 2.5 L × 70 = 175
  });

  it('rounds half away from zero to the cent', () => {
    expect(lineTotalCents(333, 100)).toBe(33); // 0.333 × 1.00 = 0.333
    expect(lineTotalCents(335, 100)).toBe(34); // 0.335 → 0.34
    expect(lineTotalCents(-335, 100)).toBe(-34);
  });
});

describe('formatting', () => {
  it('formats KES', () => {
    expect(formatKES(125000)).toMatch(/1,250/);
    expect(formatKES(7050)).toMatch(/70\.5/);
  });

  it('formats litres', () => {
    expect(formatLitres(2500)).toBe('2.5 L');
  });

  it('round-trips cents to an input string', () => {
    expect(centsToKesString(7050)).toBe('70.50');
    expect(centsToKesString(-5)).toBe('-0.05');
    expect(kesToCents(centsToKesString(123456))).toBe(123456);
  });
});
