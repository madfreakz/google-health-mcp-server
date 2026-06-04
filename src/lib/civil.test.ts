import { describe, it, expect } from 'vitest';
import {
  dateToCivil,
  civilDaysAgo,
  civilNextDay,
  civilToISODate,
  isoDateToCivil,
  toNumber,
  extractValue,
  civilFromPath,
  metricValue,
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

describe('toNumber', () => {
  it('coerces numbers and stringified int64s, rejects junk', () => {
    expect(toNumber(8034)).toBe(8034);
    expect(toNumber('8034')).toBe(8034);       // int64 comes back as a string
    expect(toNumber('1685.4')).toBeCloseTo(1685.4);
    expect(toNumber('')).toBeNull();
    expect(toNumber('abc')).toBeNull();
    expect(toNumber(undefined)).toBeNull();
  });
});

describe('extractValue', () => {
  it('reads a stringified int64 at the configured valueField path', () => {
    const point = { civilStartTime: { date: { year: 2026, month: 6, day: 3 } }, steps: { countSum: '8034' } };
    expect(extractValue(point, 'steps.countSum')).toBe(8034);
  });

  it('falls back to the first numeric leaf when the valueField path misses', () => {
    const point = { totalCalories: { kcalSum: 1685.4 } };
    expect(extractValue(point, 'totalCalories.energySum')).toBeCloseTo(1685.4);
  });

  it('skips civil-time stamps and dataSource metadata when scanning', () => {
    const point = {
      civilStartTime: { date: { year: 2026, month: 6, day: 3 } },
      dataSource: { platform: 'HEALTH_KIT' },
      distance: { millimetersSum: '5929495' },
    };
    expect(extractValue(point, undefined)).toBe(5929495);
  });

  it('returns null for an empty point', () => {
    const point = { civilStartTime: { date: { year: 2026, month: 6, day: 3 } } };
    expect(extractValue(point, 'steps.countSum')).toBeNull();
  });
});

describe('metricValue (azm reducer)', () => {
  const spec = { valueField: 'activeZoneMinutes', combine: 'azm' as const };

  it('weights cardio/peak double, fat burn single', () => {
    const point = { activeZoneMinutes: { sumInFatBurnHeartZone: '3', sumInCardioHeartZone: '2', sumInPeakHeartZone: '1' } };
    expect(metricValue(point, spec)).toBe(3 + 2 * 2 + 2 * 1); // = 9
  });

  it('handles the single-fat-burn-minute case (real Fitbit Air data)', () => {
    const point = { activeZoneMinutes: { sumInCardioHeartZone: '0', sumInPeakHeartZone: '0', sumInFatBurnHeartZone: '1' } };
    expect(metricValue(point, spec)).toBe(1);
  });

  it('returns null when the AZM object is absent (empty day)', () => {
    expect(metricValue({ civilStartTime: { date: { year: 2026, month: 6, day: 4 } } }, spec)).toBeNull();
  });

  it('falls back to plain extraction when no combine strategy', () => {
    const point = { steps: { countSum: '8034' } };
    expect(metricValue(point, { valueField: 'steps.countSum' })).toBe(8034);
  });
});

describe('civilFromPath', () => {
  it('reads a nested rollup civilStartTime.date', () => {
    const point = { civilStartTime: { date: { year: 2026, month: 6, day: 3 }, time: {} } };
    expect(civilFromPath(point, 'civilStartTime.date')).toEqual({ year: 2026, month: 6, day: 3 });
  });

  it('reads a list point\'s embedded date (resting HR shape)', () => {
    const point = { dailyRestingHeartRate: { date: { year: 2026, month: 6, day: 1 }, beatsPerMinute: '71' } };
    expect(civilFromPath(point, 'dailyRestingHeartRate.date')).toEqual({ year: 2026, month: 6, day: 1 });
  });

  it('returns null when the path is absent', () => {
    expect(civilFromPath({}, 'civilStartTime.date')).toBeNull();
  });
});
