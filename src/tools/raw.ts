import { z } from 'zod';

import { listDataPoints } from '../client';
import { DATA_TYPES } from '../constants';
import { ToolResult } from '../types';

// NOTE: the v4 list endpoint's `filter` grammar is not the RFC-3339 `endTime >= "…"` form the
// docs imply — the live API rejects that with INVALID_DATA_POINT_FILTER_RESTRICTION_COMPARABLE
// (verified 2026-06-03). Until the correct grammar is pinned, this tool lists the most-recent
// points (each carries its own embedded date) and exposes a raw `filter` passthrough for power
// users. For date-windowed summaries, prefer get_daily_summary.

export const listRawDataPointsInputSchema = {
  data_type: z.string()
    .describe(`Google Health dataType segment. Common keys map to: ${Object.entries(DATA_TYPES).map(([k, v]) => `${k}→${v.dataType}`).join(', ')}. You may also pass a raw dataType string the API supports (e.g. heart-rate, sleep, weight, exercise).`),
  filter: z.string().optional()
    .describe('Raw API filter string, passed through verbatim. The list filter grammar is not standardized in the v4 beta — omit unless you know it. For date ranges, use get_daily_summary instead.'),
  page_size: z.number().int().min(1).max(10000).optional().describe('Max points per page. Default 1000 (lists most recent first).'),
  max_pages: z.number().int().min(1).max(10).optional().describe('Max pages to fetch. Default 5.'),
};

export async function listRawDataPoints(args: {
  data_type: string;
  filter?: string;
  page_size?: number;
  max_pages?: number;
}): Promise<ToolResult> {
  // Resolve a friendly key to its API dataType, or pass the string through.
  const dataType = DATA_TYPES[args.data_type]?.dataType ?? args.data_type;

  const points = await listDataPoints(dataType, {
    filter: args.filter,
    pageSize: args.page_size,
    maxPages: args.max_pages,
  });

  const summary = `Fetched ${points.length} raw data point(s) for dataType "${dataType}"${args.filter ? ` (filter: ${args.filter})` : ''}.`;
  return {
    content: [
      { type: 'text' as const, text: summary },
      { type: 'text' as const, text: JSON.stringify(points, null, 2) },
    ],
  };
}

