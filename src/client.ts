import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config();

import {
  GH_API_BASE,
  GH_OAUTH_TOKEN,
  GH_TOKENS_PATH,
  GH_USER,
  GH_SOURCE_ALL,
  USER_AGENT,
  MIN_REQUEST_INTERVAL_MS,
  RETRY_AFTER_429_MS,
  RETRY_AFTER_5XX_MS,
  MAX_SERVER_RETRIES,
  MAX_RATE_RETRIES,
  DEFAULT_PAGE_SIZE,
  DEFAULT_MAX_PAGES,
  CACHE_TTL_SUMMARY_MS,
  CACHE_TTL_LIST_MS,
  CACHE_TTL_DEVICES_MS,
} from './constants';

import {
  GoogleHealthTokens,
  CivilDate,
  DailyRollUpResponse,
  RollupDataPoint,
  ListDataPointsResponse,
  DataPoint,
  ListPairedDevicesResponse,
  PairedDevice,
} from './types';

// ---- In-memory cache ----
interface CacheEntry<T> { data: T; expiresAt: number; }
const cache = new Map<string, CacheEntry<unknown>>();

async function getCached<T>(key: string, fetcher: () => Promise<T>, ttlMs: number): Promise<T> {
  const entry = cache.get(key);
  if (entry && entry.expiresAt > Date.now()) return entry.data as T;
  const data = await fetcher();
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
  return data;
}

// ---- Throttle ----
let lastRequestAt = 0;
async function throttle(): Promise<void> {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < MIN_REQUEST_INTERVAL_MS) {
    await new Promise(r => setTimeout(r, MIN_REQUEST_INTERVAL_MS - elapsed));
  }
  lastRequestAt = Date.now();
}

// ---- Tokens (lazy load + atomic write) ----
let tokens: GoogleHealthTokens | null = null;

function ensureClientCreds(t: Partial<GoogleHealthTokens>): GoogleHealthTokens {
  const client_id = t.client_id || process.env.GOOGLE_HEALTH_CLIENT_ID;
  const client_secret = t.client_secret || process.env.GOOGLE_HEALTH_CLIENT_SECRET;
  if (!client_id || !client_secret) {
    throw new Error(
      'Missing Google Health client credentials. Set GOOGLE_HEALTH_CLIENT_ID and ' +
      'GOOGLE_HEALTH_CLIENT_SECRET in .env, or include them in the tokens file. ' +
      'See README.md for the Google Cloud setup.'
    );
  }
  return { ...(t as GoogleHealthTokens), client_id, client_secret };
}

export function loadTokens(): GoogleHealthTokens {
  if (tokens) return tokens;
  if (!fs.existsSync(GH_TOKENS_PATH)) {
    throw new Error(
      `Google Health tokens file not found at ${GH_TOKENS_PATH}. Run 'npm run oauth' to authorize.`
    );
  }
  try {
    const raw = JSON.parse(fs.readFileSync(GH_TOKENS_PATH, 'utf-8')) as Partial<GoogleHealthTokens>;
    tokens = ensureClientCreds(raw);
    return tokens;
  } catch (e) {
    throw new Error(
      `Failed to parse Google Health tokens at ${GH_TOKENS_PATH}: ${e instanceof Error ? e.message : e}. ` +
      `Delete the file and re-run 'npm run oauth'.`
    );
  }
}

export function saveTokens(t: GoogleHealthTokens): void {
  const dir = path.dirname(GH_TOKENS_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${GH_TOKENS_PATH}.${process.pid}.${process.hrtime.bigint().toString(36)}.tmp`;
  try {
    const fd = fs.openSync(tmp, 'w', 0o600);
    try {
      fs.writeSync(fd, JSON.stringify(t, null, 2));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, GH_TOKENS_PATH);
    try { fs.chmodSync(GH_TOKENS_PATH, 0o600); } catch { /* best effort */ }
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* best effort */ }
    throw e;
  }
  tokens = t;
}

// Coalesce concurrent refreshes into one network call.
let inflightRefresh: Promise<GoogleHealthTokens> | null = null;

async function refreshTokens(): Promise<GoogleHealthTokens> {
  if (inflightRefresh) return inflightRefresh;
  inflightRefresh = (async (): Promise<GoogleHealthTokens> => {
    const current = loadTokens();
    const body = new URLSearchParams({
      client_id: current.client_id,
      client_secret: current.client_secret,
      grant_type: 'refresh_token',
      refresh_token: current.refresh_token,
    });
    let res: AxiosResponse;
    try {
      res = await axios.post(GH_OAUTH_TOKEN, body, {
        timeout: 15_000,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
    } catch (err) {
      const e = err as AxiosError<{ error?: string; error_description?: string }>;
      const detail = e.response?.data?.error_description || e.response?.data?.error || e.message;
      // The common case in OAuth "testing" mode: refresh tokens expire after 7 days.
      throw new Error(
        `Token refresh failed (${detail}). If your OAuth app is in "testing" mode, refresh ` +
        `tokens expire after 7 days — re-run 'npm run oauth'. To get long-lived tokens, ` +
        `publish the OAuth consent screen to production (see README.md).`
      );
    }
    const data = res.data as {
      access_token: string;
      expires_in: number;
      refresh_token?: string; // Google omits this on refresh — keep the existing one
      scope?: string;
      token_type?: string;
    };
    const next: GoogleHealthTokens = {
      ...current,
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? current.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + data.expires_in,
      scope: data.scope ?? current.scope,
      token_type: data.token_type ?? current.token_type,
    };
    saveTokens(next);
    return next;
  })().finally(() => { inflightRefresh = null; });
  return inflightRefresh;
}

async function ensureFreshToken(): Promise<string> {
  const t = loadTokens();
  const now = Math.floor(Date.now() / 1000);
  if (t.expires_at - 60 <= now) {
    const refreshed = await refreshTokens();
    return refreshed.access_token;
  }
  return t.access_token;
}

// ---- HTTP wrapper ----
const httpClient = axios.create({
  baseURL: GH_API_BASE,
  timeout: 30_000,
  headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
});

interface RequestRetryState {
  authRetried?: boolean;
  serverRetries?: number;
  rateRetries?: number;
}

async function request<T>(config: AxiosRequestConfig, retry: RequestRetryState = {}): Promise<T> {
  await throttle();
  const token = await ensureFreshToken();
  try {
    const res = await httpClient.request<T>({
      ...config,
      headers: { ...(config.headers ?? {}), Authorization: `Bearer ${token}` },
    });
    return res.data;
  } catch (err) {
    const e = err as AxiosError<{ error?: { message?: string; status?: string } }>;
    const status = e.response?.status;

    if (status === 401 && !retry.authRetried) {
      await refreshTokens();
      return request<T>(config, { ...retry, authRetried: true });
    }
    if (status === 429 && (retry.rateRetries ?? 0) < MAX_RATE_RETRIES) {
      const headerVal = Number(e.response?.headers['retry-after']);
      const retryAfter = Number.isFinite(headerVal) && headerVal > 0
        ? Math.max(1000, headerVal * 1000)
        : RETRY_AFTER_429_MS;
      await new Promise(r => setTimeout(r, retryAfter));
      return request<T>(config, { ...retry, rateRetries: (retry.rateRetries ?? 0) + 1 });
    }
    if (status && status >= 500 && (retry.serverRetries ?? 0) < MAX_SERVER_RETRIES) {
      const backoff = RETRY_AFTER_5XX_MS * Math.pow(2, retry.serverRetries ?? 0);
      await new Promise(r => setTimeout(r, backoff));
      return request<T>(config, { ...retry, serverRetries: (retry.serverRetries ?? 0) + 1 });
    }
    // Surface the API's structured error message when present.
    const apiMsg = e.response?.data?.error?.message;
    if (apiMsg) throw new Error(`Google Health API error (${status}): ${apiMsg}`);
    throw err;
  }
}

// ---- API methods ----

/**
 * The API's `range.start`/`range.end` are CivilDateTime messages — a nested
 * `{ date: {year,month,day}, time: {hours,minutes,seconds,nanos} }` — NOT a bare
 * civil date. (The published dailyRollUp doc example showing a flat {year,month,day}
 * is wrong; the live API rejects it with "Unknown name 'year' at 'range.start'".)
 */
function civilDateTime(c: CivilDate) {
  return {
    date: { year: c.year, month: c.month, day: c.day },
    time: { hours: 0, minutes: 0, seconds: 0, nanos: 0 },
  };
}

/** Daily rolled-up buckets for one dataType across a civil-date range (end exclusive). */
export async function dailyRollUp(
  dataType: string,
  start: CivilDate,
  end: CivilDate,
  opts: { windowSizeDays?: number; dataSourceFamily?: string } = {},
): Promise<RollupDataPoint[]> {
  const cacheKey = `rollup:${dataType}:${civilKey(start)}:${civilKey(end)}:${opts.windowSizeDays ?? 1}:${opts.dataSourceFamily ?? GH_SOURCE_ALL}`;
  return getCached(cacheKey, async () => {
    const points: RollupDataPoint[] = [];
    let pageToken: string | undefined;
    let pages = 0;
    do {
      const resp = await request<DailyRollUpResponse>({
        method: 'POST',
        url: `/${GH_USER}/dataTypes/${dataType}/dataPoints:dailyRollUp`,
        // NOTE: pageSize is intentionally omitted — the :dailyRollUp endpoint rejects it with
        // a 400 "Invalid argument" (verified live 2026-06-03). Daily buckets are tiny, so a
        // single page covers any realistic window; we still follow nextPageToken if present.
        data: {
          range: { start: civilDateTime(start), end: civilDateTime(end) },
          windowSizeDays: opts.windowSizeDays ?? 1,
          pageToken,
          dataSourceFamily: opts.dataSourceFamily ?? GH_SOURCE_ALL,
        },
      });
      points.push(...(resp.rollupDataPoints ?? []));
      pageToken = resp.nextPageToken;
      pages += 1;
    } while (pageToken && pages < DEFAULT_MAX_PAGES);
    return points;
  }, CACHE_TTL_SUMMARY_MS);
}

/** Raw data points for one dataType, optionally filtered by an API filter string. */
export async function listDataPoints(
  dataType: string,
  opts: { filter?: string; pageSize?: number; maxPages?: number } = {},
): Promise<DataPoint[]> {
  const cacheKey = `list:${dataType}:${opts.filter ?? ''}:${opts.pageSize ?? DEFAULT_PAGE_SIZE}`;
  return getCached(cacheKey, async () => {
    const out: DataPoint[] = [];
    let pageToken: string | undefined;
    let pages = 0;
    const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
    do {
      const resp = await request<ListDataPointsResponse>({
        method: 'GET',
        url: `/${GH_USER}/dataTypes/${dataType}/dataPoints`,
        params: {
          pageSize: opts.pageSize ?? DEFAULT_PAGE_SIZE,
          pageToken,
          filter: opts.filter,
        },
      });
      out.push(...(resp.dataPoints ?? []));
      pageToken = resp.nextPageToken;
      pages += 1;
    } while (pageToken && pages < maxPages);
    return out;
  }, CACHE_TTL_LIST_MS);
}

/** Devices paired to the account (Apple Watch import, Fitbit Air, Pixel Watch, ...). */
export async function listPairedDevices(): Promise<PairedDevice[]> {
  return getCached('pairedDevices', async () => {
    const resp = await request<ListPairedDevicesResponse>({
      method: 'GET',
      url: `/${GH_USER}/pairedDevices`,
    });
    return resp.pairedDevices ?? [];
  }, CACHE_TTL_DEVICES_MS);
}

function civilKey(c: CivilDate): string {
  return `${c.year}-${c.month}-${c.day}`;
}

export function clearCache(): void {
  cache.clear();
  tokens = null;
}

/** Scopes currently granted, per the persisted token file. */
export function grantedScopes(): string[] {
  const t = loadTokens();
  return (t.scope ?? '').split(/\s+/).filter(Boolean);
}
