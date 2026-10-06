import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { structuredEvent, safeTelemetryEvent, newCorrelationId } from '../../packages/shared/dist/index.js';
import { monitor, probe } from '../production-health-monitor.mjs';
import { checkRollbackTarget } from '../rollback-policy.mjs';

test('allowlisted schemas remove arbitrary text, nested objects, IDs and every SDK context', () => {
  const secret = 'sentinel-password-token-plaintext-ciphertext@example.test';
  const fields = { event: secret, timestamp: secret, level: secret, component: secret, requestId: secret,
    method: secret, reason: secret, operation: secret, outcome: secret, path: secret,
    url: secret, email: secret, userId: secret, error: { message: secret, stack: secret },
    password: secret, token: secret, ciphertext: secret, tags: { secret }, durationMs: Infinity };
  assert.deepEqual(structuredEvent(secret, fields), { schemaVersion: 1, event: 'client_error' });
  const id = newCorrelationId();
  assert.equal(structuredEvent('sync_result', { requestId: id }).requestId, id);
  assert.equal(structuredEvent('sync_result', { requestId: '9d151da8-2bfe-4b26-80df-94a90f56bbe0' }).requestId, undefined);
  assert.equal(safeTelemetryEvent({ exception: fields, request: fields, extra: fields }), null);
  const sentry = safeTelemetryEvent({ message: 'vaultmaster_event', extra: fields, exception: fields,
    breadcrumbs: [fields], request: fields, user: fields, contexts: fields, tags: fields });
  assert.ok(!JSON.stringify(sentry).includes(secret));
  assert.deepEqual(Object.keys(sentry), ['type', 'message', 'level', 'extra']);
});

test('monitor tolerates cold start/transient failures, alerts only after three failures and rejects stale/missing backup signals', async () => {
  const now = 1800000000000, events = [];
  const emit = event => events.push(event);
  const good = () => new Response(JSON.stringify({ service: 'api', status: 'ok', checks: { database: { status: 'ok' } } }));
  let calls = 0, waits = 0;
  assert.equal(await monitor({ now, lastBackupSuccess: now, emit, wait: async () => { waits++; },
    fetcher: async () => { calls++; if (calls === 1) throw new Error('secret'); return good(); } }), true);
  assert.equal(waits, 1); assert.equal(events.length, 0);
  calls = 0;
  assert.equal(await monitor({ now, lastBackupSuccess: now - 26 * 3600000, emit, wait: async () => {}, fetcher: async () => { calls++; return new Response('private-body', { status: 503 }); } }), false);
  assert.equal(calls, 9); assert.equal(events.length, 2);
  assert.ok(!JSON.stringify(events).includes('private-body'));
  assert.equal(await probe('https://synthetic.test/ready', async () => new Response('x'.repeat(4097))), false);
  assert.equal(await probe('https://synthetic.test/ready', async () => new Response(JSON.stringify({ service: 'api', status: 'ok' }))), false);
});

test('rollback policy aborts malformed pins, tracked/untracked migrations and dependency drift', () => {
  const repo = mkdtempSync(join(tmpdir(), 'vm-rollback-policy-'));
  const git = args => execFileSync('git', args, { cwd: repo, stdio: 'pipe', encoding: 'utf8' }).trim();
  try {
    git(['init']); git(['config', 'user.email', 'fixture@example.test']); git(['config', 'user.name', 'Fixture']);
    mkdirSync(join(repo, 'apps/api/prisma'), { recursive: true });
    writeFileSync(join(repo, 'apps/api/prisma/schema.prisma'), 'synthetic'); writeFileSync(join(repo, 'pnpm-lock.yaml'), 'synthetic');
    git(['add', '.']); git(['commit', '-m', 'fixture']);
    const target = { schemaVersion: 1, gitSha: git(['rev-parse', 'HEAD']), scope: 'local-compatible-candidate-only', lastMigration: '20261006020000_sensitive_action_security' };
    assert.equal(checkRollbackTarget(target, repo), target.gitSha);
    assert.throws(() => checkRollbackTarget({ ...target, gitSha: 'HEAD' }, repo), /not approved/);
    writeFileSync(join(repo, 'apps/api/prisma/new.sql'), 'synthetic');
    assert.throws(() => checkRollbackTarget(target, repo), /abort/); rmSync(join(repo, 'apps/api/prisma/new.sql'));
    writeFileSync(join(repo, 'pnpm-lock.yaml'), 'changed'); assert.throws(() => checkRollbackTarget(target, repo), /abort/);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('rollback drill rejects connection arguments and scrubs inherited cloud/telemetry/preload settings', () => {
  const script = new URL('../observability-rollback-drill.sh', import.meta.url).pathname;
  assert.equal(spawnSync('bash', [script, 'synthetic-secret-url'], { encoding: 'utf8' }).status, 1);
  const directory = mkdtempSync(join(tmpdir(), 'vm-rollback-safety-'));
  try {
    writeFileSync(join(directory, 'pg_config'), `#!/bin/sh
for name in DATABASE_URL SENTRY_DSN NODE_OPTIONS RENDER_API_KEY CLOUDFLARE_API_TOKEN; do
  if /usr/bin/printenv "$name" >/dev/null; then exit 44; fi
done
printf '%s\\n' '/missing-drill-tools'
`, { mode: 0o700 });
    const result = spawnSync('bash', [script], { encoding: 'utf8', env: { ...process.env,
      PATH: `${directory}:${process.env.PATH}`, DATABASE_URL: 'sentinel', SENTRY_DSN: 'sentinel',
      NODE_OPTIONS: 'sentinel', RENDER_API_KEY: 'sentinel', CLOUDFLARE_API_TOKEN: 'sentinel' } });
    assert.equal(result.status, 1); assert.match(result.stderr, /Missing PostgreSQL tool/);
    assert.ok(!result.stderr.includes('sentinel'));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
