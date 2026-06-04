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
- **The API is beta; union field names are not pinned.** Daily rollup points carry the metric
  in a union field (e.g. `steps: {count_sum}`). `src/lib/civil.ts:extractDailyValue` tries the
  configured `scoreField` dotted path, then falls back to the first numeric leaf. The raw point
  is ALWAYS returned alongside the normalized value — never drop it. If a summary value reads as
  `—` but data exists, fix the `scoreField` in `src/constants.ts:DATA_TYPES` against the raw point.
- **Civil dates, not timestamps, for rollups.** The `:dailyRollUp` request takes a
  `CivilTimeInterval` ({year,month,day}, end exclusive). All date math is in `src/lib/civil.ts`
  and is host-timezone-local (matches the watch's notion of "a day"). Keep it unit-tested.
- **The list-endpoint filter field name is a guess.** `src/tools/raw.ts:buildFilter` uses
  `endTime >= "…" AND endTime < "…"`. If the API 400s on it, adjust the field name; callers can
  pass a raw `filter` to override. The `:dailyRollUp` path (structured `range`) is the reliable
  one — prefer it.
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
