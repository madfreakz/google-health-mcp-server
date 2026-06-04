import { CivilDate } from '../types';

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

/** Walk a dotted path; returns the value or undefined. */
export function getAtPath(obj: unknown, dotted: string): unknown {
  let cur: unknown = obj;
  for (const seg of dotted.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/** Coerce a finite number or a numeric string (the API returns int64 as a string). */
export function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Pull a scalar out of a data point.
 *
 * Tries the configured `valueField` dotted path first (e.g. "steps.countSum"), then
 * falls back to the first numeric leaf under any non-metadata field — so an unforeseen
 * shape never silently drops a value. The raw point is always returned alongside, so
 * nothing is lost even if a mapping needs adjusting. Returns null for an empty point.
 */
export function extractValue(point: Record<string, unknown>, valueField?: string): number | null {
  if (valueField) {
    const viaPath = toNumber(getAtPath(point, valueField));
    if (viaPath !== null) return viaPath;
  }
  for (const [k, v] of Object.entries(point)) {
    if (k === 'civilStartTime' || k === 'civilEndTime' || k === 'dataSource') continue;
    const leaf = firstNumericLeaf(v);
    if (leaf !== null) return leaf;
  }
  return null;
}

function firstNumericLeaf(v: unknown): number | null {
  const n = toNumber(v);
  if (n !== null) return n;
  if (v && typeof v === 'object') {
    for (const val of Object.values(v as Record<string, unknown>)) {
      const leaf = firstNumericLeaf(val);
      if (leaf !== null) return leaf;
    }
  }
  return null;
}

/** Read a {year,month,day} civil date from a dotted path on a point. */
export function civilFromPath(point: Record<string, unknown>, dateField: string): CivilDate | null {
  const d = getAtPath(point, dateField);
  if (d && typeof d === 'object') {
    const o = d as Record<string, unknown>;
    if (typeof o.year === 'number' && typeof o.month === 'number' && typeof o.day === 'number') {
      return { year: o.year, month: o.month, day: o.day };
    }
  }
  return null;
}
