import { CivilDate, RollupDataPoint } from '../types';

/** Local-calendar civil date for a JS Date (uses the host timezone, like the watch's day). */
export function dateToCivil(d: Date): CivilDate {
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

/** Civil date N days before `from` (default: today), host-local. */
export function civilDaysAgo(n: number, from: Date = new Date()): CivilDate {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  d.setDate(d.getDate() - n);
  return dateToCivil(d);
}

/** Civil date one day after the given one — useful for the exclusive `end` bound. */
export function civilNextDay(c: CivilDate): CivilDate {
  const d = new Date(c.year, c.month - 1, c.day);
  d.setDate(d.getDate() + 1);
  return dateToCivil(d);
}

/** "YYYY-MM-DD" for a civil date. */
export function civilToISODate(c: CivilDate): string {
  const mm = String(c.month).padStart(2, '0');
  const dd = String(c.day).padStart(2, '0');
  return `${c.year}-${mm}-${dd}`;
}

/** Parse "YYYY-MM-DD" into a civil date. Throws on malformed input. */
export function isoDateToCivil(s: string): CivilDate {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) throw new Error(`Expected a YYYY-MM-DD date, got "${s}".`);
  const [, y, mo, d] = m;
  return { year: Number(y), month: Number(mo), day: Number(d) };
}

/**
 * Pull a scalar out of a rollup point.
 *
 * Tries the configured `scoreField` dotted path first (e.g. "steps.count_sum").
 * If that misses — the API's union field names are still settling in beta — it
 * falls back to the first finite numeric leaf found under the metric object,
 * skipping the civil-time stamps. Returns null when the bucket has no value
 * (Google omits the field entirely for empty intervals).
 */
export function extractDailyValue(
  point: RollupDataPoint,
  scoreField?: string,
): number | null {
  if (scoreField) {
    const viaPath = getNumberAtPath(point, scoreField);
    if (viaPath !== null) return viaPath;
  }
  for (const [k, v] of Object.entries(point)) {
    if (k === 'civilStartTime' || k === 'civilEndTime') continue;
    const leaf = firstNumericLeaf(v);
    if (leaf !== null) return leaf;
  }
  return null;
}

function getNumberAtPath(obj: unknown, dotted: string): number | null {
  let cur: unknown = obj;
  for (const seg of dotted.split('.')) {
    if (cur == null || typeof cur !== 'object') return null;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return typeof cur === 'number' && Number.isFinite(cur) ? cur : null;
}

function firstNumericLeaf(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v && typeof v === 'object') {
    for (const val of Object.values(v as Record<string, unknown>)) {
      const leaf = firstNumericLeaf(val);
      if (leaf !== null) return leaf;
    }
  }
  return null;
}
