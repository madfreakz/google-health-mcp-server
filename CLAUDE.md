# Working notes for AI assistants

Operational context for Claude/Cursor/etc. when modifying this repo. Built mirroring the
sibling `strava-mcp-server` conventions (same axios + dotenv + zod + MCP SDK stack, same
OAuth-bootstrap / atomic-token-write / in-memory-cache / retry idioms).

## Known pitfalls

- **Refresh tokens expire after 7 days, and you can't easily fix it.** Google Health scopes are
  **Restricted**, so publishing the OAuth app to Production (the usual "long-lived token" fix)
  triggers a mandatory security **verification (CASA)** with no click-through bypass — impractical
  for one user. So the app stays in **Testing** and the 7-day expiry is permanent. Design around
  it, don't fight it: `src/client.ts:refreshTokens` throws a clear "re-run npm run oauth" message
  on expiry; interactive use re-auths lazily (the assistant runs `npm run oauth` when a call
  reports expiry); the launchd sync (every 4 days, see `launchd/`) is **best-effort** —
  `src/cli/sync.ts` logs "re-auth needed", fires a macOS notification via `osascript`, and exits 0
  if the token lapsed (no crash-loop, no proactive re-auth). The 4-day cadence only narrows the
  staleness window; it can't extend the refresh token's life (only an interactive `npm run oauth`
  does that), so don't "fix" empty data by tightening the interval further — there's a hard floor
  set by how often Mark is willing to click through a browser consent screen.
- **`buildDailySummary`'s per-metric `catch` must re-throw auth failures (fixed 2026-06-29).**
  `src/tools/summary.ts` swallows per-metric errors so one unavailable dataType (e.g. AZM on an
  Apple Watch) doesn't sink the whole summary — but a blanket `catch { points = [] }` was also
  swallowing "Token refresh failed", so an expired token silently rendered as "no data" instead of
  surfacing the real error. This broke re-auth detection everywhere: `get_daily_summary` looked
  like an empty range instead of erroring, and the launchd cron's "re-auth needed" branch in
  `sync.ts` never fired because the error never escaped `buildDailySummary`. Fixed by
  `client.ts:isReauthError(err)` — checked first in the catch, re-thrown if true, only genuine
  per-metric gaps are swallowed. If you touch this catch again, keep that check first.
- **Google does NOT rotate the refresh_token on refresh** (unlike Strava). The refresh
  response usually omits `refresh_token`; `refreshTokens` keeps the existing one
  (`data.refresh_token ?? current.refresh_token`). A refresh_token is only issued on the
  *first* consent, which is why the authorize URL sets `access_type=offline` **and**
  `prompt=consent`. If a user re-auths and gets no refresh_token, they must revoke at
  <https://myaccount.google.com/permissions> first.
- **The published v4 docs were WRONG on several points — these were verified against the live API
  on 2026-06-03 (see `DATA_TYPES` in `src/constants.ts`):**
  - dataType IDs are **kebab-case** and not the obvious names: active calories =
    `active-energy-burned`, active minutes = `active-zone-minutes`, resting HR =
    `daily-resting-heart-rate`. `steps`/`distance` are as-named. A wrong ID 400s with "Invalid
    data type ID referenced…". Other verified types: `heart-rate` (rollup → avg/max/min),
    `floors`, `total-calories`, `sleep`.
  - **`active-zone-minutes` is per-heart-zone, not a single sum:** the value object is
    `{sumInFatBurnHeartZone, sumInCardioHeartZone, sumInPeakHeartZone}` (strings). `DATA_TYPES`
    marks it `combine:'azm'` and `lib/civil.ts:metricValue` reduces to Fitbit's weighted total
    (fatBurn×1 + cardio×2 + peak×2). It's a Fitbit/Pixel metric — empty from Apple Watch.
  - **DO NOT use `total-calories` for "calories burned".** From the Apple Watch import it carries
    only basal/resting energy — a flat near-constant (~1704 kcal/day, identical to 4 decimals
    across days; verified) with NO active component. Use **`active-energy-burned`**, which varies
    with movement (key `activeCalories`). `total-calories` is rollup-only (no list).
  - `:dailyRollUp` **`range.start`/`range.end` are nested `CivilDateTime`** —
    `{date:{year,month,day}, time:{hours,minutes,seconds,nanos}}` — NOT a flat `{year,month,day}`
    (the doc example is wrong; a flat date 400s with "Unknown name 'year' at 'range.start'").
    Built by `client.ts:civilDateTime`.
  - **Do NOT send `pageSize` to `:dailyRollUp`** — it 400s with "Invalid argument in request".
    (List endpoint accepts pageSize fine.)
  - **`dataSourceFamily: users/me/dataSourceFamilies/all-sources`** is what surfaces the Apple
    Watch (HEALTH_KIT) import. `google-wearables` is Fitbit/Pixel only.
  - Values come back **camelCase, and int64s are STRINGS** (`steps.countSum:"8034"`,
    `distance.millimetersSum:"…"` — note millimetres). `kcalSum` is a real number.
    `civilStartTime.date` is nested. `lib/civil.ts:extractValue` coerces strings; `civilFromPath`
    reads the embedded date. The raw point is ALWAYS returned alongside — never drop it.
- **Resting HR and sleep do NOT support `:dailyRollUp`** (the API says use list/get/reconcile).
  `DATA_TYPES[].method` is `'rollup'` or `'list'`; `summary.ts:buildDailySummary` dispatches on it.
  List-method metrics carry their own embedded date (e.g. `dailyRestingHeartRate.date`), so we
  list recent points and clip to the window. Sleep is not modeled yet (empty until a device logs
  it — re-check the shape against live data once the Fitbit Air syncs).
- **The list-endpoint `filter` grammar is unknown.** `endTime >= "…"` 400s with
  INVALID_DATA_POINT_FILTER_RESTRICTION_COMPARABLE. `list_data_points` lists most-recent and
  exposes a raw `filter` passthrough only. For date windows, use the rollup-based summary.
- **Civil date math** lives in `src/lib/civil.ts`, host-timezone-local (matches the watch's notion
  of "a day"), and is unit-tested. Keep it that way.
- **MCP SDK deep-instantiation.** `registerTool` trips TS2589 when a raw zod shape contains
  `z.array()`/`z.boolean()`, and the error hops between calls as TS's depth budget shifts. Fixed
  by casting those `inputSchema` refs `as any` in `src/index.ts` (compile-time only — the real
  schema still validates at runtime). Handlers keep explicit return types (`ToolResult`) and
  strict arg types. `npm run build` uses `--noCheck` regardless.

## Build, test, run

```bash
npm install
npm run build         # tsc --noCheck → dist/
npm run typecheck     # strict, excludes tests; should be clean
npm test              # vitest — civil-date math + value extraction, no network
npm run oauth         # one-time browser auth flow
npm run sync          # standalone incremental sync (what the launchd cron runs)
node dist/index.js    # run the MCP server on stdio
```

## File map

```
src/
├── index.ts              # MCP bootstrap + tool registration
├── client.ts             # HTTP wrapper, OAuth refresh, cache, throttle, retry
├── constants.ts          # endpoints, scopes, dataType registry, env, TTLs
├── types.ts              # API wire shapes + ToolResult + internal types
├── lib/
│   ├── civil.ts          # pure civil-date math + extractDailyValue
│   └── civil.test.ts     # unit tests (no network)
├── auth/
│   └── oauth-bootstrap.ts  # npm run oauth — loopback PKCE authorization-code flow
├── cli/
│   └── sync.ts             # npm run sync — what launchd invokes
└── tools/
    ├── summary.ts        # get_daily_summary + buildDailySummary (reused by sync)
    ├── raw.ts            # list_data_points
    ├── devices.ts        # list_paired_devices, connection_status
    └── obsidian.ts       # sync_health_to_obsidian + dashboard + syncCli
```

## Environment

Env vars (loaded via dotenv from `.env`, also overridable via the MCP `env:` block):
- `GOOGLE_HEALTH_CLIENT_ID`, `GOOGLE_HEALTH_CLIENT_SECRET` — only needed for `npm run oauth`;
  the runtime reads them back from the tokens file.
- `GOOGLE_HEALTH_TOKENS_PATH` — default `~/.config/google-health-mcp/tokens.json`.
- `GOOGLE_HEALTH_OAUTH_PORT` — default 47813; must match the registered redirect URI.
- `OBSIDIAN_VAULT_PATH` — vault root; if unset, the sync tool is disabled (others still work).

## Don't touch

- The sync writes to `{vault}/Lifestyle/Health/` and `{vault}/Lifestyle/Health-Dashboard.md`.
  If the user keeps a hand-maintained narrative health note elsewhere, leave it alone — the
  per-day notes are derived/regenerable, the dashboard is overwritten each run.
