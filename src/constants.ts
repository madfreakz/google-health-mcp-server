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
// Maps a friendly key → the Google Health `dataType` path segment, the retrieval
// method, and the dotted paths to the value + day for each returned point. All IDs,
// field names, and methods below were VERIFIED against the live v4 API on 2026-06-03
// (the published docs were partly wrong). Notes:
//   - `rollup` types use the :dailyRollUp endpoint; their day is in civilStartTime.date.
//   - `list` types don't support rollup (the API rejects it); we list recent points and
//     bucket by the point's own embedded date.
//   - int64 fields come back as STRINGS (e.g. countSum:"8034"); extractValue coerces them.
//   - distance is millimetres; sleep is not modeled yet (empty until a device logs it).
export type RetrievalMethod = 'rollup' | 'list';

export interface DataTypeSpec {
  key: string;             // friendly name used in tool args / summaries
  dataType: string;        // path segment: users/me/dataTypes/<dataType>
  method: RetrievalMethod;
  unit: string;            // raw unit of the extracted value
  valueField: string;      // dotted path into a point to the scalar value
  dateField: string;       // dotted path into a point to its {year,month,day}
}

export const DATA_TYPES: Record<string, DataTypeSpec> = {
  steps:             { key: 'steps',             dataType: 'steps',                     method: 'rollup', unit: 'steps', valueField: 'steps.countSum',                       dateField: 'civilStartTime.date' },
  distance:          { key: 'distance',          dataType: 'distance',                  method: 'rollup', unit: 'mm',    valueField: 'distance.millimetersSum',              dateField: 'civilStartTime.date' },
  // NOTE: use active-energy-burned, NOT total-calories. From the Apple Watch import, total-calories
  // is basal-only and reports a flat near-constant (~1704 kcal/day) with no active component;
  // active-energy-burned varies with movement and is what a user means by "calories burned".
  activeCalories:    { key: 'activeCalories',    dataType: 'active-energy-burned',      method: 'rollup', unit: 'kcal',  valueField: 'activeEnergyBurned.kcalSum',           dateField: 'civilStartTime.date' },
  activeZoneMinutes: { key: 'activeZoneMinutes', dataType: 'active-zone-minutes',       method: 'rollup', unit: 'AZM',   valueField: 'activeZoneMinutes.minutesSum',         dateField: 'civilStartTime.date' },
  floors:            { key: 'floors',            dataType: 'floors',                    method: 'rollup', unit: 'floors',valueField: 'floors.countSum',                      dateField: 'civilStartTime.date' },
  restingHeartRate:  { key: 'restingHeartRate',  dataType: 'daily-resting-heart-rate',  method: 'list',   unit: 'bpm',   valueField: 'dailyRestingHeartRate.beatsPerMinute', dateField: 'dailyRestingHeartRate.date' },
  // avg/max/min all roll up from the same `heart-rate` call (cached by the client, so 1 network hit).
  heartRateAvg:      { key: 'heartRateAvg',      dataType: 'heart-rate',                method: 'rollup', unit: 'bpm',   valueField: 'heartRate.beatsPerMinuteAvg',          dateField: 'civilStartTime.date' },
  heartRateMax:      { key: 'heartRateMax',      dataType: 'heart-rate',                method: 'rollup', unit: 'bpm',   valueField: 'heartRate.beatsPerMinuteMax',          dateField: 'civilStartTime.date' },
  heartRateMin:      { key: 'heartRateMin',      dataType: 'heart-rate',                method: 'rollup', unit: 'bpm',   valueField: 'heartRate.beatsPerMinuteMin',          dateField: 'civilStartTime.date' },
};

// The default panel pulled by get_daily_summary. (heartRateMin stays available via the `metrics`
// arg but is left out of the default to keep the table readable — it tracks resting HR closely.)
export const DEFAULT_SUMMARY_KEYS = [
  'steps', 'distance', 'activeCalories', 'activeZoneMinutes', 'floors',
  'restingHeartRate', 'heartRateAvg', 'heartRateMax',
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
