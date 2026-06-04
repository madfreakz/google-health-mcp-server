# Working notes for AI assistants

Operational context for Claude/Cursor/etc. when modifying this repo. Built mirroring the
sibling `strava-mcp-server` conventions (same axios + dotenv + zod + MCP SDK stack, same
OAuth-bootstrap / atomic-token-write / in-memory-cache / retry idioms).

## Known pitfalls

- **Refresh tokens expire after 7 days in OAuth "testing" mode.** This is the #1 operational
  gotcha. `src/client.ts:refreshTokens` catches the failure and throws a message telling the
  user to re-run `npm run oauth` or publish the OAuth app to Production. Long-lived tokens
  require Production publishing status.
- **Google does NOT rotate the refresh_token on refresh** (unlike Strava). The refresh
  response usually omits `refresh_token`; `refreshTokens` keeps the existing one
  (`data.refresh_token ?? current.refresh_token`). A refresh_token is only issued on the
  *first* consent, which is why the authorize URL sets `access_type=offline` **and**
  `prompt=consent`. If a user re-auths and gets no refresh_token, they must revoke at
  <https://myaccount.google.com/permissions> first.
- **The published v4 docs were WRONG on several points — these were verified against the live API
  on 2026-06-03 (see `DATA_TYPES` in `src/constants.ts`):**
  - dataType IDs are **kebab-case** and not the obvious names: calories = `total-calories`,
    active minutes = `active-zone-minutes`, resting HR = `daily-resting-heart-rate`. `steps` and
    `distance` are as-named. A wrong ID 400s with "Invalid data type ID referenced…".
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
