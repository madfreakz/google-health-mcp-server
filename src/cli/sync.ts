import * as dotenv from 'dotenv';
dotenv.config();

import { syncCli } from '../tools/obsidian';

syncCli().catch(err => {
  const msg = err instanceof Error ? err.message : String(err);
  // A lapsed/absent token is expected and benign for this best-effort monthly sync — log a
  // clean note and exit 0 (no crash-loop, no nag). Re-auth happens lazily on next interactive use.
  if (/Token refresh failed|tokens file not found|re-run 'npm run oauth'/.test(msg)) {
    process.stderr.write(`Google Health sync skipped: re-auth needed (run 'npm run oauth'). Details: ${msg}\n`);
    process.exit(0);
  }
  process.stderr.write(`Sync failed: ${msg}\n`);
  process.exit(1);
});
