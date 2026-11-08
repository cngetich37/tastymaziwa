import { describe, expect, it } from 'vitest';
import { addDays, dayLabel, daysBetween, lastNDates, nairobiHour, parseDateParam, toBusinessDate } from './dates';

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

describe('day page helpers', () => {
  const today = '2026-11-08';

  it('parses a date parameter, falling back to today', () => {
    expect(parseDateParam('2026-11-01', today)).toBe('2026-11-01');
    expect(parseDateParam(undefined, today)).toBe(today);
    expect(parseDateParam('yesterday', today)).toBe(today);
    expect(parseDateParam('2026-02-30', today)).toBe(today);
    expect(parseDateParam('2026-12-01', today)).toBe(today); // future
    expect(parseDateParam(['2026-11-01'], today)).toBe(today);
  });

  it('labels days relative to today', () => {
    expect(dayLabel(today, today)).toBe('Today');
    expect(dayLabel('2026-11-07', today)).toBe('Yesterday');
    expect(dayLabel('2026-11-01', today)).toBe('1 Nov 2026');
  });

  it('reads the hour in Nairobi time, whatever the server zone', () => {
    expect(nairobiHour(new Date('2026-11-08T03:30:00Z'))).toBe(6);
    expect(nairobiHour(new Date('2026-11-08T14:00:00Z'))).toBe(17);
    expect(nairobiHour(new Date('2026-11-08T21:00:00Z'))).toBe(0);
  });
});
