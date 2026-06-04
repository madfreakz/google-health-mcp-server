// ---- MCP tool result ----
// Explicit return type for tool handlers. Annotating handlers with this keeps
// the MCP SDK's registerTool generic from instantiating an excessively deep type.
export type ToolResult = { content: Array<{ type: 'text'; text: string }> };

// ---- OAuth token persistence ----
export interface GoogleHealthTokens {
  client_id: string;
  client_secret: string;
  access_token: string;
  refresh_token: string;
  /** Absolute expiry, unix seconds. */
  expires_at: number;
  scope: string;
  token_type?: string;
}

// ---- Civil date (the API's calendar-date type) ----
export interface CivilDate {
  year: number;
  month: number; // 1-12
  day: number;   // 1-31
}

// ---- dailyRollUp wire shapes ----
// range.start/range.end are CivilDateTime messages: a nested civil date + time-of-day.
export interface CivilDateTime {
  date: CivilDate;
  time: { hours: number; minutes: number; seconds: number; nanos: number };
}

export interface CivilTimeInterval {
  start: CivilDateTime;
  end: CivilDateTime; // exclusive upper bound
}

export interface DailyRollUpRequest {
  range: CivilTimeInterval;
  windowSizeDays?: number;
  pageSize?: number;
  pageToken?: string;
  dataSourceFamily?: string;
}

/**
 * One rolled-up bucket. The metric value lives in a union field keyed by the
 * data type (e.g. `steps`, `restingHeartRate`); we keep the whole object and
 * extract a scalar best-effort, so an unknown shape never drops data.
 */
export interface RollupDataPoint {
  civilStartTime?: CivilDateTime;
  civilEndTime?: CivilDateTime;
  [metric: string]: unknown;
}

export interface DailyRollUpResponse {
  rollupDataPoints?: RollupDataPoint[];
  nextPageToken?: string;
}

// ---- list dataPoints wire shapes ----
export interface DataPoint {
  name?: string;
  dataType?: string;
  startTime?: string; // RFC-3339
  endTime?: string;   // RFC-3339
  [field: string]: unknown;
}

export interface ListDataPointsResponse {
  dataPoints?: DataPoint[];
  nextPageToken?: string;
}

// ---- paired devices ----
export interface PairedDevice {
  name?: string;
  displayName?: string;
  manufacturer?: string;
  model?: string;
  type?: string;
  [field: string]: unknown;
}

export interface ListPairedDevicesResponse {
  pairedDevices?: PairedDevice[];
  nextPageToken?: string;
}

// ---- normalized summary returned by get_daily_summary ----
export interface DailyMetric {
  key: string;
  unit: string;
  /** Best-effort scalar; null when the point carried no value. */
  value: number | null;
  /** The raw point (rollup or list), kept so nothing is lost to a mapping guess. */
  raw: Record<string, unknown>;
}

export interface DailySummaryDay {
  date: string; // YYYY-MM-DD (civilStartTime)
  metrics: Record<string, DailyMetric>;
}
