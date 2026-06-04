import { describe, it, expect } from 'vitest';
import {
  dateToCivil,
  civilDaysAgo,
  civilNextDay,
  civilToISODate,
  isoDateToCivil,
  extractDailyValue,
} from './civil';

describe('civil date helpers', () => {
  it('converts a Date to a 1-indexed-month civil date', () => {
    expect(dateToCivil(new Date(2026, 5, 3))).toEqual({ year: 2026, month: 6, day: 3 });
  });

  it('walks back N days across a month boundary', () => {
    const from = new Date(2026, 5, 3); // 3 Jun 2026
    expect(civilDaysAgo(4, from)).toEqual({ year: 2026, month: 5, day: 30 });
  });

  it('computes the exclusive next-day end bound across month end', () => {
    expect(civilNextDay({ year: 2026, month: 5, day: 31 })).toEqual({ year: 2026, month: 6, day: 1 });
  });

  it('round-trips ISO date <-> civil', () => {
    const c = isoDateToCivil('2026-06-03');
    expect(c).toEqual({ year: 2026, month: 6, day: 3 });
    expect(civilToISODate(c)).toBe('2026-06-03');
  });

  it('rejects malformed ISO dates', () => {
    expect(() => isoDateToCivil('June 3')).toThrow();
  });
});

describe('extractDailyValue', () => {
  it('reads the configured dotted scoreField', () => {
    const point = { civilStartTime: { year: 2026, month: 6, day: 3 }, steps: { count_sum: 8234 } };
    expect(extractDailyValue(point, 'steps.count_sum')).toBe(8234);
  });

  it('falls back to the first numeric leaf when the scoreField path misses', () => {
    const point = { restingHeartRate: { bpm_value: 52 } };
    expect(extractDailyValue(point, 'restingHeartRate.bpm')).toBe(52);
  });

  it('skips the civil-time stamps when scanning for a leaf', () => {
    const point = { civilStartTime: { year: 2026, month: 6, day: 3 }, distance: { distance_sum: 4200.5 } };
    expect(extractDailyValue(point, undefined)).toBe(4200.5);
  });

  it('returns null for an empty interval (no metric field set)', () => {
    const point = { civilStartTime: { year: 2026, month: 6, day: 3 }, civilEndTime: { year: 2026, month: 6, day: 4 } };
    expect(extractDailyValue(point, 'steps.count_sum')).toBeNull();
  });
});
