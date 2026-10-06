import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, symlink, readdir } from 'node:fs/promises';
import { execFileSync, fork } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { checkRollbackTarget } from './rollback-policy.mjs';
import { monitor } from './production-health-monitor.mjs';
import { createVaultKey, encryptJSON, decryptJSON } from '../packages/crypto/dist/index.js';
const work = process.env.VM_DRILL_WORK;
assert.match(work ?? '', /^\/tmp\/vm-drill\.[A-Za-z0-9]+$/);
assert.equal(process.env.DATABASE_URL, `postgresql://drill@localhost/drill_source?host=${work}/socket`);
assert.equal(process.env.SENTRY_DSN, undefined);
const repo = fileURLToPath(new URL('..', import.meta.url));
const target = JSON.parse(await readFile(new URL('../docs/rollback-target.json', import.meta.url)));
const sha = checkRollbackTarget(target, repo);
await mkdir(`${work}/previous`);
// Only pinned tracked source; no .env, working-tree changes or cloud credentials.
const archive = execFileSync('git', ['archive', sha, 'apps/api', 'tsconfig.base.json'], { cwd: repo });
execFileSync('tar', ['-x', '-C', `${work}/previous`], { input: archive });
await symlink(`${repo}/apps/api/node_modules`, `${work}/previous/apps/api/node_modules`);
execFileSync(`${repo}/node_modules/.bin/tsc`, ['--project', `${work}/previous/apps/api/tsconfig.json`], { stdio: 'pipe' });
const { registerUser, authorizedRequest: request } = await import('../apps/api/tests/integration-helpers.mjs');
const { prisma } = await import('../apps/api/dist/config/prisma.js');
async function artifactDigest(directory) {
  const hash = createHash('sha256');
  async function visit(relative = '') {
    const entries = await readdir(`${directory}/${relative}`, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(path);
      else { hash.update(path); hash.update(await readFile(`${directory}/${path}`)); }
    }
  }
  await visit(); return hash.digest('hex');
}
const artifacts = { candidateApi: await artifactDigest(`${repo}/apps/api/dist`),
  rollbackApi: await artifactDigest(`${work}/previous/apps/api/dist`),
  shared: await artifactDigest(`${repo}/packages/shared/dist`) };
const children = new Set();
async function server(module) {
  const child = fork(fileURLToPath(new URL('./rollback-server.mjs', import.meta.url)), [], {
    cwd: `${work}/runtime/work`, env: { ...process.env, VM_ROLLBACK_MODULE: pathToFileURL(module).href },
    // Raw old-artifact logging is disabled in worker; no output retained here.
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  children.add(child);
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Rollback startup timeout')); }, 15000);
    child.once('message', message => { clearTimeout(timer); resolve(message.port); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('Rollback startup failed')); });
  });
  return { base: `http://127.0.0.1:${port}`, async stop() {
    const ended = new Promise(resolve => child.once('exit', resolve));
    child.send('stop'); await ended; children.delete(child);
  } };
}
let account, item;
const checks = {};
try {
  await prisma.abuseBucket.deleteMany();
  const current = await server(`${repo}/apps/api/dist/index.js`);
  assert.equal((await request(current.base, '/api/health/ready')).status, 200);
  const key = await createVaultKey();
  const encrypted = await encryptJSON({ title: 'synthetic rollback', password: 'synthetic-only' }, key);
  account = await registerUser(current.base);
  assert.equal(account.response.status, 201);
  const headers = { authorization: `Bearer ${account.accessToken}` };
  const created = await request(current.base, '/api/vault', { method: 'POST', headers,
    body: { encryptedData: encrypted.ciphertext, iv: encrypted.iv } });
  assert.equal(created.status, 201); item = created.body.data;
  const versions = await prisma.$queryRaw`SELECT migration_name, checksum FROM _prisma_migrations ORDER BY migration_name`;
  await current.stop(); // candidate -> pinned artifact, same retained migrated database
  const previous = await server(`${work}/previous/apps/api/dist/index.js`);
  for (let i = 0; i < 3; i++) assert.equal((await request(previous.base, '/api/health/ready')).status, 200);
  const synced = await request(previous.base, '/api/vault', { headers });
  assert.equal(synced.status, 200);
  const recovered = synced.body.data.find(row => row.id === item.id);
  assert.deepEqual(await decryptJSON(recovered.encryptedData, recovered.iv, key), { title: 'synthetic rollback', password: 'synthetic-only' });
  assert.equal((await request(previous.base, '/api/backups/snapshot?version=4', { headers })).status, 200);
  // Retained P0-4 security: writes needing reauth still fail closed without proof.
  const denied = await fetch(`${previous.base}/api/auth/export-authorize`, { method: 'POST', headers });
  assert.equal(denied.status, 403);
  assert.deepEqual(await prisma.$queryRaw`SELECT migration_name, checksum FROM _prisma_migrations ORDER BY migration_name`, versions);
  checks.rollback = { readinessSamples: 3, retainedMigrationCount: versions.length,
    existingSessionSyncAndDecryption: 'passed', v4Snapshot: 'passed', sensitiveActionPolicy: 'retained', migrationHistory: 'unchanged' };
  const writtenAfterRollback = await request(previous.base, "/api/vault", { method: "POST", headers, body: { encryptedData: encrypted.ciphertext, iv: encrypted.iv } });
  assert.equal(writtenAfterRollback.status, 201);
  await previous.stop();
  const resumed = await server(`${repo}/apps/api/dist/index.js`);
  assert.equal((await request(resumed.base, '/api/health/ready')).status, 200);
  const forward = await request(resumed.base, '/api/vault', { headers });
  assert.equal(forward.status, 200);
  const afterRollback = forward.body.data.find(row => row.id === writtenAfterRollback.body.data.id);
  assert.deepEqual(await decryptJSON(afterRollback.encryptedData, afterRollback.iv, key), { title: 'synthetic rollback', password: 'synthetic-only' });
  await resumed.stop(); checks.forwardRecovery = 'passed';
  const events = [];
  const now = Date.now();
  const healthy = new Response(JSON.stringify({ service: 'api', status: 'ok', checks: { database: { status: 'ok' } } }));
  assert.equal(await monitor({ fetcher: async () => healthy.clone(), wait: async () => {}, lastBackupSuccess: now, now, emit: e => events.push(e) }), true);
  assert.equal(events.length, 0);
  let probes = 0;
  assert.equal(await monitor({ fetcher: async () => { probes++; throw new Error('synthetic-private-error'); }, wait: async () => {}, lastBackupSuccess: 0, now, emit: e => events.push(e) }), false);
  assert.equal(probes, 9); assert.equal(events.length, 2);
  assert.ok(!JSON.stringify(events).includes('synthetic-private-error'));
  checks.monitor = { healthy: 'silent', repeatedFailures: 'alerts', missingBackupHeartbeat: 'alerts', secretRedaction: 'passed' };
  await prisma.user.delete({ where: { id: account.data.user.id } }); account = null;
  await prisma.abuseBucket.deleteMany();
  const tables = await prisma.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != '_prisma_migrations'`;
  for (const { tablename } of tables) {
    assert.match(tablename, /^[a-z_]+$/);
    const [row] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::integer AS count FROM "${tablename}"`);
    assert.equal(row.count, 0);
  }
  const regressionLog = await readFile(`${work}/commands.log`, 'utf8');
  const tests = regressionLog.match(/(?:ℹ |# )tests (\d+)/g)?.at(-1)?.match(/\d+/)?.[0];
  const failures = regressionLog.match(/(?:ℹ |# )fail (\d+)/g)?.at(-1)?.match(/\d+/)?.[0];
  const skipped = regressionLog.match(/(?:ℹ |# )skipped (\d+)/g)?.at(-1)?.match(/\d+/)?.[0];
  assert.ok(Number(tests) > 0); assert.equal(failures, '0'); assert.equal(skipped, '0');
  checks.apiRegression = { tests: Number(tests), failures: 0, skipped: 0 };
  await writeFile(process.env.VM_DRILL_REPORT, JSON.stringify({ schemaVersion: 1, status: 'incomplete',
    timestamp: new Date().toISOString(), targetSha: sha, artifactsSha256: artifacts, revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
    scenarioSha256: createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex'),
    scope: 'synthetic-only; local Unix socket; TCP disabled; no provider deploy', checks }, null, 2) + '\n');
} finally {
  for (const child of children) child.kill('SIGTERM');
  if (account?.data?.user) await prisma.user.delete({ where: { id: account.data.user.id } });
  await prisma.$disconnect();
}
