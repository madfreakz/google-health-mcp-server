# 🩺 google-health-mcp-server

**Hand your whole-body health data to your AI — steps, distance, heart rate, and more from Apple Watch, Fitbit, or Pixel Watch, unified through Google Health.**

![MCP](https://img.shields.io/badge/protocol-MCP-6E56CF?style=flat-square)
![Google Health API v4](https://img.shields.io/badge/Google%20Health%20API-v4-4285F4?style=flat-square)
![License: MIT](https://img.shields.io/badge/license-MIT-green?style=flat-square)

An MCP server for the **Google Health API v4** — read your daily activity, sleep, heart
rate, and body metrics from any source connected to Google Health (Apple Watch import,
Fitbit Air, Pixel Watch, ...) in Claude or any MCP client, and optionally sync them into
an Obsidian vault.

Self-hosted and local-first: it uses **your own** Google Cloud OAuth app, tokens are stored
on your machine at mode `0600`, and no health data leaves your control.

> **Beta notice.** The Google Health API v4 is new (public beta; legacy Fitbit Web API
> turns down September 2026). Field shapes may still shift. This server normalizes daily
> values best-effort and **always returns the raw rollup points alongside**, so nothing is
> lost if a field mapping in `src/constants.ts` needs a tweak against live data.

## Tools

| Tool | What it does |
|---|---|
| `get_daily_summary` | Per-day table of steps, distance, active calories, active minutes, resting HR, sleep over a date range (or trailing `days`). **Start here.** |
| `list_data_points` | Raw, un-rolled-up points for one dataType — intraday HR, sleep stages, or any type not in the summary. |
| `list_paired_devices` | Devices paired to the account — confirm a new device (e.g. Fitbit Air) has connected. |
| `connection_status` | Health-check: token works? which scopes granted? which metrics actually return data over the last 7 days? **Run this first after setup.** |
| `sync_health_to_obsidian` | Daily markdown notes under `{vault}/Lifestyle/Health/` + a rolling 7/30-day dashboard. |

## One-time setup

### 1. Google Cloud project + API

1. Create or pick a project at <https://console.cloud.google.com/>.
2. **Enable the Google Health API:**
   <https://console.cloud.google.com/apis/library/health.googleapis.com>

### 2. OAuth consent screen

1. Go to **APIs & Services → OAuth consent screen**. User type **External**.
2. Fill in the app name and your email.
3. Under **Audience → Test users**, add your own Google account.
4. On the **Data access** page, add these scopes (search "Google Health"):
   - `…/auth/googlehealth.profile.readonly`
   - `…/auth/googlehealth.settings.readonly`
   - `…/auth/googlehealth.activity_and_fitness.readonly`
   - `…/auth/googlehealth.health_metrics_and_measurements.readonly`
   - `…/auth/googlehealth.sleep.readonly`
   - `…/auth/googlehealth.nutrition.readonly`

> ⚠️ **7-day token caveat (and why you should stay in Testing).** While the consent screen is
> in **Testing** status, Google issues refresh tokens that **expire after 7 days**. You might
> expect to fix this by publishing to **Production** — but the Google Health scopes are Google's
> **Restricted** tier, and Restricted scopes in Production require a full security **verification
> (CASA assessment)**. There is *no* "click through the unverified warning" bypass for Restricted
> scopes (that bypass only exists for *Sensitive* scopes). Verification is impractical for a
> single-user personal tool, so the recommended setup is: **keep the app in Testing, add yourself
> as a Test user, and accept the 7-day expiry.** Re-authorize lazily — only when you actually use
> the data and a call reports the token has lapsed — by re-running `npm run oauth` (a ~10s browser
> approve). Don't bother re-authing in weeks you don't touch the data.

### 3. OAuth credentials

1. **APIs & Services → Credentials → Create credentials → OAuth client ID.**
2. Application type: **Web application**.
3. Under **Authorized redirect URIs**, add exactly:
   ```
   http://localhost:47813/callback
   ```
   (Must match `GOOGLE_HEALTH_OAUTH_PORT`. Change both together if 47813 is taken.)
4. Copy the **Client ID** and **Client secret**.

### 4. Configure + authorize

```bash
npm install
cp .env.example .env          # then paste your client ID + secret into .env
npm run oauth                 # opens a browser; approve access. Tokens saved to
                              # ~/.config/google-health-mcp/tokens.json (mode 0600)
npm run build
```

Verify it works:

```bash
node dist/index.js            # should print "Google Health MCP server running on stdio"
```

…or call `connection_status` once registered in your MCP client.

## Register in Claude

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` and restart Claude:

```json
{
  "mcpServers": {
    "google-health": {
      "command": "node",
      "args": ["/Users/<you>/projects/google-health-mcp-server/dist/index.js"],
      "env": {
        "GOOGLE_HEALTH_TOKENS_PATH": "/Users/<you>/.config/google-health-mcp/tokens.json",
        "OBSIDIAN_VAULT_PATH": "/Users/<you>/Documents/Obsidian Vault"
      }
    }
  }
}
```

The runtime reads the client ID/secret back from the tokens file, so they don't need to be
in the MCP `env` block — only the token path and (optionally) the vault path.

## Obsidian sync (optional)

Interactive queries via the MCP tools are always live and pull on demand. The Obsidian notes +
dashboard only need a periodic refresh, so set `OBSIDIAN_VAULT_PATH` and either call
`sync_health_to_obsidian` from Claude or run the CLI:

```bash
npm run sync                  # incremental sync since last run
```

For an automated refresh, a launchd template is in `launchd/`. Copy it to
`~/Library/LaunchAgents/`, replace `__USERNAME__`, and
`launchctl bootstrap gui/$(id -u) <plist>`. It runs **every 4 days** (well under the 7-day
refresh-token expiry) and is **best-effort**: if the token has lapsed it logs a "re-auth needed"
note, fires a macOS notification, and exits cleanly (no crash-loop) — re-auth with
`npm run oauth` (~10s browser approve).

> **The 4-day cadence narrows staleness, it does not prevent expiry.** The cron can only
> refresh the *access* token; the *refresh* token's 7-day Testing-mode cap is fixed by Google
> regardless of how often it runs, and getting a new refresh token requires the one-time
> interactive browser approval in `npm run oauth` — that step can't be scripted into a cron.
> What the cadence change buys you is a couple of chances per week to *notice* an expiry (via
> the notification) instead of going silent for up to a month.

## Develop

```bash
npm run build       # tsc --noCheck → dist/
npm run typecheck   # strict type check (excludes tests)
npm test            # vitest — pure logic (civil-date math, value extraction)
npm run dev         # build + run the server on stdio
```

See `CLAUDE.md` for architecture notes and known pitfalls.
