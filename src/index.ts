import * as dotenv from 'dotenv';
dotenv.config();

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { getDailySummaryInputSchema, getDailySummary } from './tools/summary';
import { listRawDataPointsInputSchema, listRawDataPoints } from './tools/raw';
import {
  listPairedDevicesInputSchema, listPairedDevicesTool,
  connectionStatusInputSchema, connectionStatus,
} from './tools/devices';
import { syncHealthInputSchema, syncHealthToObsidian } from './tools/obsidian';

const server = new McpServer({
  name: 'google-health-mcp-server',
  version: '1.0.0',
});

server.registerTool(
  'get_daily_summary',
  {
    title: 'Get Daily Health Summary',
    description:
      'Daily rolled-up health metrics (steps, distance, active calories, active minutes, resting ' +
      'heart rate, sleep) across all connected Google Health sources (Apple Watch import, Fitbit ' +
      'Air, Pixel Watch). Returns a per-day table plus the raw rollup points. Use start_date/end_date ' +
      'for an explicit range, or `days` (default 7) for a trailing window. This is the primary tool ' +
      'for "how have my steps/sleep/resting HR trended" questions.',
    // `as any`: the MCP SDK's registerTool generic instantiates an excessively deep type when a
    // raw zod shape contains z.array()/z.boolean(). The cast is compile-time only — the real schema
    // object still reaches the SDK at runtime for arg validation. Handler args stay strictly typed.
    inputSchema: getDailySummaryInputSchema as any,
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  getDailySummary,
);

server.registerTool(
  'list_data_points',
  {
    title: 'List Raw Health Data Points',
    description:
      'Fetch raw (un-rolled-up) data points for a single Google Health dataType — use when you need ' +
      'finer-than-daily granularity (e.g. intraday heart rate samples, individual sleep stages) or a ' +
      'dataType not covered by get_daily_summary. Accepts a friendly key (steps, sleep, heartRate, ...) ' +
      'or a raw API dataType string, plus an optional date range or raw filter. Prefer get_daily_summary ' +
      'for trend/summary questions — it is far cheaper.',
    // `as any`: same SDK deep-instantiation workaround as get_daily_summary.
    inputSchema: listRawDataPointsInputSchema as any,
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  listRawDataPoints,
);

server.registerTool(
  'list_paired_devices',
  {
    title: 'List Paired Devices',
    description:
      'List devices paired to the Google Health account (e.g. Apple Watch import source, Fitbit Air, ' +
      'Pixel Watch) with manufacturer/model/type. Useful to confirm a new device has connected.',
    inputSchema: listPairedDevicesInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  listPairedDevicesTool,
);

server.registerTool(
  'connection_status',
  {
    title: 'Check Connection Status',
    description:
      'Health-check the Google Health connection: confirms the OAuth token works, reports granted vs ' +
      'recommended scopes, and probes which metrics actually return data over the last 7 days. Run this ' +
      'first when setting up or after a new device syncs to confirm data is flowing.',
    inputSchema: connectionStatusInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  connectionStatus,
);

server.registerTool(
  'sync_health_to_obsidian',
  {
    title: 'Sync Health to Obsidian',
    description:
      'Export daily health summaries to Obsidian as per-day markdown notes under {vault}/Lifestyle/Health/ ' +
      '(frontmatter: steps, distance_km, calories, active_minutes, resting_hr, sleep_hours for Dataview), ' +
      'and refresh {vault}/Lifestyle/Health-Dashboard.md with rolling 7/30-day aggregates. Runs ' +
      'incrementally from the last sync by default; set full_sync=true to re-render the whole window. ' +
      'Requires OBSIDIAN_VAULT_PATH to be set.',
    // `as any`: see the note on get_daily_summary — z.boolean() in the shape trips the SDK generic.
    inputSchema: syncHealthInputSchema as any,
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  syncHealthToObsidian,
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('Google Health MCP server running on stdio\n');
}

main().catch(err => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
