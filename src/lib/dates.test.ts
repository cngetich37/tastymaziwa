import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, lastNDates, toBusinessDate } from './dates';

describe('toBusinessDate', () => {
  it('uses Nairobi time, not UTC', () => {
    // 22:30 UTC on 7 Nov is 01:30 on 8 Nov in Nairobi (UTC+3).
    expect(toBusinessDate(new Date('2026-11-07T22:30:00Z'))).toBe('2026-11-08');
    expect(toBusinessDate(new Date('2026-11-07T20:59:59Z'))).toBe('2026-11-07');
  });
});

describe('calendar arithmetic', () => {
  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
  });

  it('lists the last N dates oldest first', () => {
    expect(lastNDates(3, '2026-11-01')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01']);
  });

  it('counts days between dates', () => {
    expect(daysBetween('2026-11-01', '2026-11-08')).toBe(7);
    expect(daysBetween('2026-11-08', '2026-11-01')).toBe(-7);
  });
});
