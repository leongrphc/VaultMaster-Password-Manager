import { pathToFileURL } from 'node:url';
// Fixed public probes. No credentials, raw response bodies, URLs or exceptions in output.
const targets = {
  api: 'https://vaultmaster-api.onrender.com/api/health',
  database: 'https://vaultmaster-api.onrender.com/api/health/ready',
  proxy: 'https://vaultmaster.mozkan.com.tr/api/health/ready',
};
export async function probe(url, fetcher = fetch) {
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(90000), redirect: 'error',
      credentials: 'omit', cache: 'no-store' });
    // Bound response bytes before parsing; never print a hostile intermediary response.
    const reader = response.body?.getReader();
    if (!reader) return false;
    let size = 0, text = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 4096) return false;
        text += new TextDecoder().decode(value);
      }
    } finally { await reader.cancel(); }
    const body = JSON.parse(text);
    return response.status === 200 && body.service === 'api' && body.status === 'ok' &&
      (!url.endsWith('/ready') || body.checks?.database?.status === 'ok');
  } catch { return false; }
}
export async function monitor({ fetcher = fetch, wait = ms => new Promise(r => setTimeout(r, ms)),
  lastBackupSuccess, now = Date.now(), emit = event => console.log(JSON.stringify(event)) } = {}) {
  const result = {};
  for (const [component, url] of Object.entries(targets)) {
    let healthy = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (await probe(url, fetcher)) { healthy = true; break; }
      if (attempt < 2) await wait(30000);
    }
    result[component] = healthy;
  }
  // Suppress dependent failures: one API/database/proxy incident per poll.
  if (!result.api || !result.database || !result.proxy) emit({ schemaVersion: 1, event: 'health_alert', component: 'monitor',
    alert: result.api && !result.database ? 'database_unavailable' : 'api_unavailable',
    operation: result.api && !result.database ? 'database' : 'api', outcome: 'failure' });
  const backupTime = Number(lastBackupSuccess);
  result.backup = Number.isSafeInteger(backupTime) && backupTime > 0 && backupTime <= now && now - backupTime < 26 * 3600000;
  if (!result.backup) emit({ schemaVersion: 1, event: 'health_alert', component: 'monitor', alert: 'backup_stale', operation: 'backup', outcome: 'failure' });
  return Object.values(result).every(Boolean);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3 || process.argv[2] !== '--production') {
    console.error('Explicit --production is required for public read-only monitoring.'); process.exitCode = 1;
  } else process.exitCode = await monitor({ lastBackupSuccess: process.env.VM_BACKUP_LAST_SUCCESS_EPOCH_MS }) ? 0 : 1;
}
