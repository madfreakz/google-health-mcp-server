import { z } from 'zod';

import { listDataPoints } from '../client';
import { DATA_TYPES } from '../constants';
import { ToolResult } from '../types';

/**
 * Build a Google Health list filter from a date range. The list endpoint accepts
 * RFC-3339 timestamps with `>=` and `<`. The field name is still settling in the
 * v4 beta, so callers can pass a raw `filter` to override this default.
 */
function buildFilter(startDate?: string, endDate?: string): string | undefined {
  const clauses: string[] = [];
  if (startDate) clauses.push(`endTime >= "${startDate}T00:00:00Z"`);
  if (endDate) clauses.push(`endTime < "${endDate}T00:00:00Z"`);
  return clauses.length ? clauses.join(' AND ') : undefined;
}

export const listRawDataPointsInputSchema = {
  data_type: z.string()
    .describe(`Google Health dataType segment. Common keys map to: ${Object.entries(DATA_TYPES).map(([k, v]) => `${k}→${v.dataType}`).join(', ')}. You may also pass a raw dataType string the API supports.`),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    .describe('Inclusive lower bound YYYY-MM-DD (builds a time filter).'),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    .describe('Exclusive upper bound YYYY-MM-DD (builds a time filter).'),
  filter: z.string().optional()
    .describe('Raw API filter string. Overrides start_date/end_date when provided.'),
  page_size: z.number().int().min(1).max(10000).optional().describe('Max points per page. Default 1000.'),
  max_pages: z.number().int().min(1).max(10).optional().describe('Max pages to fetch. Default 5.'),
};

export async function listRawDataPoints(args: {
  data_type: string;
  start_date?: string;
  end_date?: string;
  filter?: string;
  page_size?: number;
  max_pages?: number;
}): Promise<ToolResult> {
  // Resolve a friendly key to its API dataType, or pass the string through.
  const dataType = DATA_TYPES[args.data_type]?.dataType ?? args.data_type;
  const filter = args.filter ?? buildFilter(args.start_date, args.end_date);

  const points = await listDataPoints(dataType, {
    filter,
    pageSize: args.page_size,
    maxPages: args.max_pages,
  });

  const summary = `Fetched ${points.length} raw data point(s) for dataType "${dataType}"${filter ? ` (filter: ${filter})` : ''}.`;
  return {
    content: [
      { type: 'text' as const, text: summary },
      { type: 'text' as const, text: JSON.stringify(points, null, 2) },
    ],
  };
}
