import * as dotenv from 'dotenv';
dotenv.config();

import { execFile } from 'child_process';
import { syncCli } from '../tools/obsidian';
import { isReauthError } from '../client';

// Fires a macOS notification so a lapsed token is surfaced immediately instead of sitting
// silently in a log file nobody checks. Fire-and-forget; notification failures shouldn't
// affect the sync's own exit code.
function notifyReauthNeeded(): void {
  execFile('osascript', [
    '-e',
    'display notification "Refresh token has expired (7-day Testing-mode cap). Run \'npm run oauth\' to restore Google Health sync." with title "Google Health MCP" sound name "Basso"',
  ], () => { /* best-effort */ });
}

syncCli().catch(err => {
  const msg = err instanceof Error ? err.message : String(err);
  // A lapsed/absent token is expected and benign for this best-effort sync — log a
  // clean note and exit 0 (no crash-loop, no nag). Re-auth happens lazily on next interactive use.
  if (isReauthError(err)) {
    process.stderr.write(`Google Health sync skipped: re-auth needed (run 'npm run oauth'). Details: ${msg}\n`);
    notifyReauthNeeded();
    process.exit(0);
  }
  process.stderr.write(`Sync failed: ${msg}\n`);
  process.exit(1);
});
