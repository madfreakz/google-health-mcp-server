import { listPairedDevices, dailyRollUp, grantedScopes } from '../client';
import { DATA_TYPES, GH_SCOPES, GH_SOURCE_ALL, OBSIDIAN_VAULT_PATH } from '../constants';
import { civilDaysAgo, civilNextDay } from '../lib/civil';
import { ToolResult } from '../types';

// ---- list_paired_devices ----
export const listPairedDevicesInputSchema = {};

export async function listPairedDevicesTool(): Promise<ToolResult> {
  const devices = await listPairedDevices();
  if (devices.length === 0) {
    return { content: [{ type: 'text' as const, text: 'No paired devices found yet. A newly set-up device may take a sync cycle to appear.' }] };
  }
  const lines = devices.map(d => {
    const label = d.displayName || d.model || d.name || 'device';
    const meta = [d.manufacturer, d.model, d.type].filter(Boolean).join(' / ');
    return `- ${label}${meta ? ` (${meta})` : ''}`;
  });
  return {
    content: [
      { type: 'text' as const, text: `Paired devices (${devices.length}):\n${lines.join('\n')}` },
      { type: 'text' as const, text: JSON.stringify(devices, null, 2) },
    ],
  };
}

// ---- connection_status ----
// A health-check tool: confirms auth works, reports granted vs recommended scopes,
// and probes which metrics actually return data over the last week. Ideal for the
// "is it working yet?" check after a new device first syncs.
export const connectionStatusInputSchema = {};

export async function connectionStatus(): Promise<ToolResult> {
  const granted = new Set(grantedScopes());
  const missing = GH_SCOPES.filter(s => !granted.has(s));

  // Probe each metric over the last 7 days; report which have any data.
  const start = civilDaysAgo(6);
  const end = civilNextDay(civilDaysAgo(0));
  const probes = await Promise.all(
    Object.values(DATA_TYPES).map(async spec => {
      try {
        const pts = await dailyRollUp(spec.dataType, start, end, { dataSourceFamily: GH_SOURCE_ALL });
        const withValue = pts.filter(p =>
          Object.keys(p).some(k => k !== 'civilStartTime' && k !== 'civilEndTime'),
        ).length;
        return { key: spec.key, ok: true, days: withValue };
      } catch (e) {
        return { key: spec.key, ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }),
  );

  const lines: string[] = [];
  lines.push('## Google Health connection status');
  lines.push('');
  lines.push(`Auth: token present, ${granted.size} scope(s) granted.`);
  if (missing.length) {
    lines.push(`Missing recommended scopes (re-run npm run oauth to add): ${missing.join(', ')}`);
  } else {
    lines.push('All recommended read scopes granted.');
  }
  lines.push('');
  lines.push('Metric availability over the last 7 days:');
  for (const p of probes) {
    if (p.ok) lines.push(`- ${p.key}: ${p.days} day(s) with data`);
    else lines.push(`- ${p.key}: error — ${p.error}`);
  }
  lines.push('');
  lines.push(`Obsidian sync: ${OBSIDIAN_VAULT_PATH ? `enabled → ${OBSIDIAN_VAULT_PATH}` : 'disabled (set OBSIDIAN_VAULT_PATH to enable)'}`);

  return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
}
