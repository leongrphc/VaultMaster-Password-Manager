import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

for (const harness of ['backup-restore-drill.sh', 'key-exchange-checks.sh']) {
const script = new URL('../' + harness, import.meta.url).pathname;

test(harness + ' rejects supplied database arguments before provisioning', () => {
  const result = spawnSync('bash', [script, 'postgresql://synthetic-sentinel.invalid/db'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /accepts no database URLs or arguments/);
  assert.ok(!result.stderr.includes('synthetic-sentinel'));
});

test(harness + ' discards connection, telemetry and Node preload settings before invoking tools', () => {
  const directory = mkdtempSync(join(tmpdir(), 'vm-drill-safety-'));
  try {
    // Stop at prerequisite validation, so this safety test needs no database.
    writeFileSync(join(directory, 'pg_config'), `#!/bin/sh
for name in DATABASE_URL DATABASE_DIRECT_URL VAULTMASTER_TEST_DATABASE_URL VAULTMASTER_TEST_DATABASE_DIRECT_URL SENTRY_DSN NODE_OPTIONS PGHOST PGPASSWORD; do
  if /usr/bin/printenv "$name" >/dev/null; then echo 'Inherited unsafe setting' >&2; exit 44; fi
done
printf '%s\\n' '/missing-drill-postgresql-tools'
`, { mode: 0o700 });
    const env = { ...process.env, PATH: `${directory}:${process.env.PATH}` };
    for (const name of ['DATABASE_URL', 'DATABASE_DIRECT_URL', 'VAULTMASTER_TEST_DATABASE_URL', 'VAULTMASTER_TEST_DATABASE_DIRECT_URL', 'SENTRY_DSN', 'NODE_OPTIONS', 'PGHOST', 'PGPASSWORD']) env[name] = 'synthetic-sentinel';
    const result = spawnSync('bash', [script], { env, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Missing PostgreSQL tool: initdb/);
    assert.ok(!result.stderr.includes('Inherited unsafe setting'));
    assert.ok(!result.stderr.includes('synthetic-sentinel'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

}
