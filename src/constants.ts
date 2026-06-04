import * as dotenv from 'dotenv';
dotenv.config();

import * as path from 'path';
import * as os from 'os';

// ---- API endpoints ----
export const GH_API_BASE = 'https://health.googleapis.com/v4';
export const GH_OAUTH_AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GH_OAUTH_TOKEN = 'https://oauth2.googleapis.com/token';
export const GH_OAUTH_REVOKE = 'https://oauth2.googleapis.com/revoke';

// The Google Health API addresses the signed-in user as `users/me`.
export const GH_USER = 'users/me';

// Data-source families the rollup/list endpoints accept. `all-sources` merges
// every connected source (Apple Watch import, Fitbit Air, Pixel Watch, ...).
export const GH_SOURCE_ALL = `${GH_USER}/dataSourceFamilies/all-sources`;
export const GH_SOURCE_WEARABLES = `${GH_USER}/dataSourceFamilies/google-wearables`;
export const GH_SOURCE_GOOGLE = `${GH_USER}/dataSourceFamilies/google-sources`;

// ---- OAuth ----
export const OBSIDIAN_VAULT_PATH = process.env.OBSIDIAN_VAULT_PATH ?? '';

export const GH_TOKENS_PATH =
  process.env.GOOGLE_HEALTH_TOKENS_PATH ??
  path.join(os.homedir(), '.config', 'google-health-mcp', 'tokens.json');

export const GH_OAUTH_PORT = Number(process.env.GOOGLE_HEALTH_OAUTH_PORT ?? 47813);
export const GH_OAUTH_REDIRECT = `http://localhost:${GH_OAUTH_PORT}/callback`;

// Read-only scope set. Mirrors the Google Health API "restricted" read scopes.
// Keep this read-only — no write scopes — so re-consent is never forced for a
// scope that could mutate data.
export const GH_SCOPES = [
  'https://www.googleapis.com/auth/googlehealth.profile.readonly',
  'https://www.googleapis.com/auth/googlehealth.settings.readonly',
  'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
  'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
  'https://www.googleapis.com/auth/googlehealth.sleep.readonly',
  'https://www.googleapis.com/auth/googlehealth.nutrition.readonly',
];

// ---- dataType registry ----
// Maps a friendly key → the Google Health `dataType` path segment and the
// rollup value field we extract for daily summaries. Field names are the API's
// best-documented shapes; `extractDailyValue` degrades gracefully if a shape
// differs, and the raw rollup point is always returned alongside the normalized
// value so nothing is lost if a mapping needs adjusting against live data.
export interface DataTypeSpec {
  key: string;          // friendly name used in tool args / summaries
  dataType: string;     // path segment: users/me/dataTypes/<dataType>
  unit: string;         // human-readable unit for display
  scoreField?: string;  // dotted path into a rollup point's value object
}

export const DATA_TYPES: Record<string, DataTypeSpec> = {
  steps:            { key: 'steps',            dataType: 'steps',              unit: 'steps', scoreField: 'steps.count_sum' },
  distance:         { key: 'distance',         dataType: 'distance',           unit: 'm',     scoreField: 'distance.distance_sum' },
  calories:         { key: 'calories',         dataType: 'activeEnergyBurned', unit: 'kcal',  scoreField: 'activeEnergyBurned.energy_sum' },
  activeMinutes:    { key: 'activeMinutes',    dataType: 'activeMinutes',      unit: 'min',   scoreField: 'activeMinutes.duration_sum' },
  heartRate:        { key: 'heartRate',        dataType: 'heartRate',          unit: 'bpm',   scoreField: 'heartRate.bpm_average' },
  restingHeartRate: { key: 'restingHeartRate', dataType: 'restingHeartRate',   unit: 'bpm',   scoreField: 'restingHeartRate.bpm' },
  sleep:            { key: 'sleep',            dataType: 'sleep',              unit: 'min',   scoreField: 'sleep.duration_sum' },
};

// The default panel pulled by get_daily_summary.
export const DEFAULT_SUMMARY_KEYS = [
  'steps', 'distance', 'calories', 'activeMinutes', 'restingHeartRate', 'sleep',
];

// ---- HTTP behavior ----
export const MIN_REQUEST_INTERVAL_MS = 300;
export const RETRY_AFTER_429_MS = 30_000;
export const RETRY_AFTER_5XX_MS = 2_000;
export const MAX_SERVER_RETRIES = 3;
export const MAX_RATE_RETRIES = 2;

// Google Health list/rollup paging
export const DEFAULT_PAGE_SIZE = 1000;
export const MAX_PAGE_SIZE = 10_000;
export const DEFAULT_MAX_PAGES = 5;

// Cache TTLs (rolled-up history is stable once a day closes; today's data churns)
export const CACHE_TTL_SUMMARY_MS = 10 * 60 * 1000;
export const CACHE_TTL_LIST_MS = 5 * 60 * 1000;
export const CACHE_TTL_DEVICES_MS = 60 * 60 * 1000;
export const CACHE_TTL_PROFILE_MS = 6 * 60 * 60 * 1000;

// ---- Obsidian sync ----
export const SYNC_DIR_NAME = path.join('Lifestyle', 'Health');
export const DASHBOARD_NAME = path.join('Lifestyle', 'Health-Dashboard.md');
export const SYNC_STATE_FILENAME = '.google-health-sync-state.json';
export const DEFAULT_SYNC_DAYS = 30;

export const USER_AGENT = 'google-health-mcp-server/1.0 (Mark Fok)';

export const BETA_NOTICE =
  'Google Health API v4 is new (public beta). Field shapes may shift; if a value reads as ' +
  '"raw" in a summary, the dataType mapping in constants.ts needs a tweak against live data.';
