import { z } from 'zod';

import { dailyRollUp, listDataPoints, isReauthError } from '../client';
import { DATA_TYPES, DEFAULT_SUMMARY_KEYS, GH_SOURCE_ALL, BETA_NOTICE, MAX_PAGE_SIZE } from '../constants';
import { CivilDate, DailyMetric, DailySummaryDay, ToolResult } from '../types';
import {
  civilDaysAgo,
  civilNextDay,
  civilToISODate,
  isoDateToCivil,
  civilFromPath,
  metricValue,
} from '../lib/civil';

function daysInclusive(a: CivilDate, b: CivilDate): number {
  const da = Date.UTC(a.year, a.month - 1, a.day);
  const db = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((db - da) / 86_400_000) + 1;
}

/**
 * Build a per-day summary across the requested metric keys for [startCivil, endCivilInclusive].
 * Dispatches per metric: `rollup` types use :dailyRollUp; `list` types (e.g. resting HR) are
 * listed recent and bucketed by each point's own embedded date, then clipped to the window.
 * Reused by both the get_daily_summary tool and the Obsidian sync.
 */
export async function buildDailySummary(
  startCivil: CivilDate,
  endCivilInclusive: CivilDate,
  keys: string[],
  dataSourceFamily: string = GH_SOURCE_ALL,
): Promise<DailySummaryDay[]> {
  const endExclusive = civilNextDay(endCivilInclusive);
  const startISO = civilToISODate(startCivil);
  const endISO = civilToISODate(endCivilInclusive);
  const byDate = new Map<string, DailySummaryDay>();

  for (const key of keys) {
    const spec = DATA_TYPES[key];
    if (!spec) continue;
    let points: Array<Record<string, unknown>> = [];
    try {
      if (spec.method === 'rollup') {
        points = await dailyRollUp(spec.dataType, startCivil, endExclusive, { dataSourceFamily });
      } else {
        // No server-side date filter (the API rejects our filter syntax); list recent and clip.
        const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(31, daysInclusive(startCivil, endCivilInclusive) + 5));
        points = await listDataPoints(spec.dataType, { pageSize, maxPages: 2 });
      }
    } catch (err) {
      // An expired/missing token must propagate — it isn't a per-metric condition,
      // and swallowing it here hides "re-auth needed" behind a misleading "no data".
      if (isReauthError(err)) throw err;
      // One unavailable metric (scope/type/source) shouldn't sink the whole summary.
      points = [];
    }
    for (const p of points) {
      const civil = civilFromPath(p, spec.dateField);
      if (!civil) continue;
      const date = civilToISODate(civil);
      if (date < startISO || date > endISO) continue; // clip list results to the window
      if (!byDate.has(date)) byDate.set(date, { date, metrics: {} });
      byDate.get(date)!.metrics[key] = {
        key,
        unit: spec.unit,
        value: metricValue(p, spec),
        raw: p,
      };
    }
  }

  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function fmtValue(m: DailyMetric | undefined): string {
  if (!m || m.value === null) return '—';
  switch (m.key) {
    case 'distance': return `${(m.value / 1_000_000).toFixed(2)} km`; // millimetres → km
    case 'steps': return Math.round(m.value).toLocaleString();
    case 'activeCalories': return `${Math.round(m.value)} kcal`;
    case 'restingHeartRate':
    case 'heartRateAvg':
    case 'heartRateMax':
    case 'heartRateMin': return `${Math.round(m.value)} bpm`;
    case 'activeZoneMinutes': return `${Math.round(m.value)} AZM`;
    default: {
      const rounded = Number.isInteger(m.value) ? m.value : Number(m.value.toFixed(1));
      return `${rounded} ${m.unit}`;
    }
  }
}

function renderSummary(days: DailySummaryDay[], keys: string[]): string {
  if (days.length === 0) {
    return 'No data points returned for this range. If your device only just synced, give ' +
      'Google Health a sync cycle and retry. ' + BETA_NOTICE;
  }
  const header = ['date', ...keys].join(' | ');
  const sep = ['---', ...keys.map(() => '---')].join(' | ');
  const rows = days.map(d => [d.date, ...keys.map(k => fmtValue(d.metrics[k]))].join(' | '));
  return [header, sep, ...rows].join('\n');
}

// ---- MCP tool: get_daily_summary ----
export const getDailySummaryInputSchema = {
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    .describe('Start date YYYY-MM-DD (inclusive). Defaults to `days` ago.'),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    .describe('End date YYYY-MM-DD (inclusive). Defaults to today.'),
  days: z.number().int().min(1).max(366).optional()
    .describe('Window size in days ending today, used only when start_date is omitted. Default 7.'),
  metrics: z.array(z.string()).optional()
    .describe(`Subset of metric keys to include. Available: ${Object.keys(DATA_TYPES).join(', ')}. Default: ${DEFAULT_SUMMARY_KEYS.join(', ')}.`),
};

export async function getDailySummary(args: {
  start_date?: string;
  end_date?: string;
  days?: number;
  metrics?: string[];
}): Promise<ToolResult> {
  const endCivil = args.end_date ? isoDateToCivil(args.end_date) : civilDaysAgo(0);
  const startCivil = args.start_date
    ? isoDateToCivil(args.start_date)
    : civilDaysAgo((args.days ?? 7) - 1);
  const keys = (args.metrics && args.metrics.length > 0 ? args.metrics : DEFAULT_SUMMARY_KEYS)
    .filter(k => DATA_TYPES[k]);

  const days = await buildDailySummary(startCivil, endCivil, keys);
  const text = renderSummary(days, keys);
  return {
    content: [
      { type: 'text' as const, text },
      { type: 'text' as const, text: '\n\nRaw rollup points:\n' + JSON.stringify(days, null, 2) },
    ],
  };
}
