import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, stopTestServer, request } from './integration-helpers.mjs';
import { logError } from '../dist/utils/logger.js';
import { HealthAlerts } from '../dist/utils/health-alerts.js';

test('API logs reject secret fields and client IDs; readiness is independent of abuse storage and fails safely', async () => {
  const { server, baseUrl } = await startTestServer();
  const { prisma } = await import('../dist/config/prisma.js');
  const logs = [];
  const previous = { log: console.log, error: console.error };
  const original = prisma.$transaction;
  const { DurableLimitStore } = await import("../dist/middleware/durable-limit.js");
  const increment = DurableLimitStore.prototype.increment;
  console.log = line => logs.push(line); console.error = line => logs.push(line);
  const sentinel = 'synthetic-sensitive@example.test';
  try {
    logError('unhandled_error', new Error(sentinel), { requestId: sentinel, path: sentinel,
      userId: sentinel, token: sentinel, ciphertext: sentinel, password: sentinel,
      details: [sentinel], extra: { sentinel }, statusCode: 500 });
    const first = await request(baseUrl, `/api/health?token=${sentinel}`, { headers: { 'x-request-id': sentinel } });
    const second = await request(baseUrl, '/api/health', { headers: { 'x-request-id': first.body.requestId } });
    assert.equal(first.status, 200);
    assert.notEqual(first.body.requestId, sentinel); assert.notEqual(first.body.requestId, second.body.requestId);
    assert.equal(first.headers.get('cache-control'), 'no-store');
    DurableLimitStore.prototype.increment = async () => { throw new Error(sentinel); };
    assert.equal((await request(baseUrl, '/api/health/ready')).status, 200);
    const ordinary = await request(baseUrl, '/api/vault');
    assert.equal(ordinary.status, 500);
    assert.equal(ordinary.body.error, 'Sunucu hatası');
    prisma.$transaction = async () => { throw new Error(sentinel); };
    const failure = await request(baseUrl, '/api/health/ready');
    assert.equal(failure.status, 503); assert.equal(failure.body.checks.database.status, 'error');
    const text = JSON.stringify(logs) + JSON.stringify(failure.body);
    assert.ok(!text.includes(sentinel), 'secret boundary failed');
    for (const line of logs) {
      const event = JSON.parse(line);
      assert.equal(event.schemaVersion, 1);
      for (const key of ['path', 'userId', 'ipAddress', 'error', 'details']) assert.equal(event[key], undefined);
    }
  } finally {
    prisma.$transaction = original; DurableLimitStore.prototype.increment = increment;
    console.log = previous.log; console.error = previous.error;
    await stopTestServer(server);
  }
});

test('readiness responds within deadline and coalesces overlapping hung database probes', async () => {
  const { server, baseUrl } = await startTestServer();
  const { prisma } = await import('../dist/config/prisma.js');
  const original = prisma.$transaction;
  let release, calls = 0;
  prisma.$transaction = () => { calls++; return new Promise(resolve => { release = resolve; }); };
  try {
    const started = Date.now();
    const responses = await Promise.all([request(baseUrl, '/api/health/ready'), request(baseUrl, '/api/health/ready')]);
    assert.ok(Date.now() - started < 6500);
    assert.equal(calls, 1);
    assert.ok(responses.every(r => r.status === 503));
  } finally {
    release(); await new Promise(resolve => setTimeout(resolve, 0)); prisma.$transaction = original;
    await stopTestServer(server);
  }
});

test('health alerts require volume and sustained server errors; validation and auth rejection stay quiet', () => {
  const events = [], alerts = new HealthAlerts((event, alert) => events.push({ event, alert }));
  for (let i = 0; i < 20; i++) alerts.record('sync', i < 5 ? 503 : 200, 1000);
  assert.deepEqual(events, [{ event: 'health_alert', alert: 'sync_errors' }]);
  alerts.record('sync', 503, 1001); assert.equal(events.length, 1);
  for (let i = 0; i < 20; i++) alerts.record('sync', 200, 301002);
  assert.equal(events.at(-1).event, 'health_recovered');
  for (let i = 0; i < 30; i++) alerts.record('api', 401, 301002);
  for (let i = 0; i < 5; i++) alerts.record('backup', i < 3 ? 500 : 200, 301002);
  assert.equal(events.at(-1).alert, 'backup_errors');
  assert.ok(!events.some(event => event.alert === 'api_errors'));
});
