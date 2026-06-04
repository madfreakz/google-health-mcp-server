import { z } from 'zod';

import { dailyRollUp } from '../client';
import { DATA_TYPES, DEFAULT_SUMMARY_KEYS, GH_SOURCE_ALL, BETA_NOTICE } from '../constants';
import { CivilDate, DailyMetric, DailySummaryDay, RollupDataPoint, ToolResult } from '../types';
import {
  civilDaysAgo,
  civilNextDay,
  civilToISODate,
  isoDateToCivil,
  extractDailyValue,
} from '../lib/civil';

/**
 * Build a per-day summary across the requested metric keys for [startCivil, endCivilInclusive].
 * Reused by both the get_daily_summary tool and the Obsidian sync.
 */
export async function buildDailySummary(
  startCivil: CivilDate,
  endCivilInclusive: CivilDate,
  keys: string[],
  dataSourceFamily: string = GH_SOURCE_ALL,
): Promise<DailySummaryDay[]> {
  const endExclusive = civilNextDay(endCivilInclusive);
  const byDate = new Map<string, DailySummaryDay>();

  for (const key of keys) {
    const spec = DATA_TYPES[key];
    if (!spec) continue;
    let points: RollupDataPoint[];
    try {
      points = await dailyRollUp(spec.dataType, startCivil, endExclusive, { dataSourceFamily });
    } catch (e) {
      // One unavailable metric (e.g. a scope not granted, or a type the device
      // doesn't produce) shouldn't sink the whole summary.
      points = [];
    }
    for (const p of points) {
      if (!p.civilStartTime) continue;
      const date = civilToISODate(p.civilStartTime as CivilDate);
      if (!byDate.has(date)) byDate.set(date, { date, metrics: {} });
      const metric: DailyMetric = {
        key,
        unit: spec.unit,
        value: extractDailyValue(p, spec.scoreField),
        raw: p,
      };
      byDate.get(date)!.metrics[key] = metric;
    }
  }

  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function fmtValue(m: DailyMetric | undefined): string {
  if (!m || m.value === null) return '—';
  // distance comes back in metres; show km for readability.
  if (m.key === 'distance') return `${(m.value / 1000).toFixed(2)} km`;
  if (m.key === 'sleep') {
    const h = Math.floor(m.value / 60);
    const min = Math.round(m.value % 60);
    return `${h}h ${min}m`;
  }
  const rounded = Number.isInteger(m.value) ? m.value : Number(m.value.toFixed(1));
  return `${rounded} ${m.unit}`;
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
