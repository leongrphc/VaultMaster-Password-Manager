import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as OTPAuth from 'otpauth';
import { authHeaders, registerUser, loginUser, request, authorizedRequest, startTestServer, stopTestServer, cleanupIntegrationUsers, disconnectPrisma } from './integration-helpers.mjs';

let server, baseUrl, prisma;
test.before(async () => { ({ prisma } = await import('../dist/config/prisma.js')); await cleanupIntegrationUsers(); ({ server, baseUrl } = await startTestServer()); });
test.after(async () => { await stopTestServer(server); await cleanupIntegrationUsers(); await disconnectPrisma(); });
const proof = (user, method, path, extra = {}, token = user.accessToken) => request(baseUrl, '/api/auth/reauthenticate', {
  method: 'POST', headers: authHeaders(token), body: { method, path, authHash: user.payload.authHash, ...extra },
});
const useProof = (user, path, response, options = {}) => request(baseUrl, '/api' + path, {
  ...options, headers: { ...authHeaders(user.accessToken), 'x-vaultmaster-reauth': response.body.data.proof },
});
const totp = secret => new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), algorithm: 'SHA1', digits: 6, period: 30 }).generate();

test('every sensitive surface rejects a session alone before revealing resource state', async () => {
  const user = await registerUser(baseUrl);
  const paths = [ ['POST','/auth/delete-account'], ['POST','/auth/change-password'], ['GET','/backups/snapshot'],
    ['POST','/auth/export-authorize'], ['POST','/AUTH/CHANGE-PASSWORD/'], ['HEAD','/backups/snapshot'], ['POST','/auth/2fa/setup'], ['POST','/auth/2fa/verify'], ['POST','/auth/2fa/disable'],
    ['POST','/auth/2fa/recovery-codes/regenerate'], ['POST','/auth/webauthn/registration/options'], ['POST','/auth/webauthn/registration/verify'],
    ['DELETE',`/auth/webauthn/credentials/${randomUUID()}`], ['PATCH',`/auth/webauthn/credentials/${randomUUID()}`],
    ['DELETE',`/devices/${user.data.deviceId}`], ['PATCH',`/devices/${randomUUID()}`], ['POST','/devices/revoke-others'] ];
  for (const [method,path] of paths) {
    const response = await request(baseUrl, '/api'+path, { method, headers: authHeaders(user.accessToken), body: ['GET','HEAD'].includes(method) ? undefined : {} });
    assert.equal(response.status, 403, path); if (method !== 'HEAD') assert.equal(response.body.code, 'REAUTH_REQUIRED'); assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal(await prisma.securityNotification.count({ where: { userId: user.data.user.id } }), 0);
  assert.equal(await prisma.device.count({ where: { userId: user.data.user.id } }), 1);
});

test('proofs bind account, device, method, target, expiry and security state; simultaneous replay has one winner', async () => {
  const user = await registerUser(baseUrl), other = await registerUser(baseUrl);
  const login = await loginUser(baseUrl, user.payload);
  const path = '/auth/export-authorize';
  const issued = await proof(user, 'POST', path);
  assert.equal(issued.status, 200);
  assert.ok(!JSON.stringify(await prisma.reauthentication.findMany()).includes(issued.body.data.proof));
  assert.equal((await useProof(other, path, issued, { method: 'POST' })).status, 403);
  const otherDevice = { ...user, accessToken: login.accessToken };
  assert.equal((await useProof(otherDevice, path, issued, { method: 'POST' })).status, 403);
  assert.equal((await useProof(user, '/backups/snapshot', issued)).status, 403);
  const concurrent = await Promise.all([1,2].map(() => useProof(user, path, issued, { method: 'POST' })));
  assert.deepEqual(concurrent.map(r => r.status).sort(), [200,403]);
  assert.equal((await useProof(user, path, issued, { method: 'POST' })).status, 403);
  const expired = await proof(user, 'POST', path);
  await prisma.reauthentication.updateMany({ where: { userId: user.data.user.id }, data: { expiresAt: new Date(0) } });
  assert.equal((await useProof(user, path, expired, { method: 'POST' })).status, 403);
  const stale = await proof(user, 'POST', path);
  await prisma.user.update({ where: { id: user.data.user.id }, data: { twoFactorEnabled: true } });
  assert.equal((await useProof(user, path, stale, { method: 'POST' })).status, 403);
  assert.equal(await prisma.securityNotification.count({ where: { userId: user.data.user.id, action: 'vault.export' } }), 1);
});

test('MFA and recovery-code reauthentication are required and concurrent recovery replay cannot issue two proofs', async () => {
  const user = await registerUser(baseUrl);
  const headers = authHeaders(user.accessToken);
  const setup = await authorizedRequest(baseUrl, '/api/auth/2fa/setup', { method: 'POST', headers });
  const enabled = await authorizedRequest(baseUrl, '/api/auth/2fa/verify', { method: 'POST', headers, body: { code: totp(setup.body.data.secret) } });
  assert.equal(enabled.status, 200);
  const challenged = await proof(user, 'POST', '/auth/2fa/disable');
  assert.equal(challenged.body.data.requires2FA, true); assert.equal(challenged.body.data.proof, undefined);
  assert.equal((await proof(user, 'POST', '/auth/2fa/disable', { code: 'invalid' })).status, 400);
  assert.equal((await proof(user, 'POST', '/auth/2fa/disable', { authHash: 'wrong', code: totp(setup.body.data.secret) })).status, 403);
  const candidate = enabled.body.data.recoveryCodes[0];
  const attempts = await Promise.all([1,2].map(() => proof(user, 'POST', '/auth/2fa/recovery-codes/regenerate', { recoveryCode: candidate })));
  assert.deepEqual(attempts.map(r => r.status).sort(), [200,403]);
  const accepted = attempts.find(r => r.status === 200);
  const regenerated = await useProof(user, '/auth/2fa/recovery-codes/regenerate', accepted, { method: 'POST', body: {} });
  assert.equal(regenerated.status, 200);
  assert.equal((await proof(user, 'POST', '/auth/2fa/disable', { recoveryCode: candidate })).status, 403);
  const disabled = await proof(user, 'POST', '/auth/2fa/disable', { recoveryCode: regenerated.body.data.recoveryCodes[0] });
  assert.equal((await useProof(user, '/auth/2fa/disable', disabled, { method: 'POST' })).status, 200);
  assert.equal((await request(baseUrl, '/api/auth/me', { headers })).status, 200);
  const inbox = await request(baseUrl, '/api/auth/security-notifications', { headers });
  assert.deepEqual(inbox.body.data.map(r => r.action).sort(), ['security.2fa.disable','security.2fa.enable','security.2fa.recovery_codes.regenerate']);
  const serialized = JSON.stringify(inbox.body);
  for (const secret of [user.payload.authHash, setup.body.data.secret, ...enabled.body.data.recoveryCodes, ...regenerated.body.data.recoveryCodes]) assert.ok(!serialized.includes(secret));
});

test('device revocation invalidates old access and proofs; unknown and foreign devices return identical responses', async () => {
  const user = await registerUser(baseUrl), other = await registerUser(baseUrl);
  const login = await loginUser(baseUrl, user.payload);
  const old = await proof(user, 'POST', '/auth/export-authorize', {}, login.accessToken);
  const authorized = await proof(user, 'POST', '/devices/revoke-others');
  const revoked = await useProof(user, '/devices/revoke-others', authorized, { method: 'POST', body: { currentDeviceId: user.data.deviceId } });
  assert.equal(revoked.status, 200);
  assert.equal((await useProof({ ...user, accessToken: login.accessToken }, '/auth/export-authorize', old, { method: 'POST' })).status, 401);
  assert.equal((await request(baseUrl, '/api/auth/me', { headers: authHeaders(user.accessToken) })).status, 200);
  const responses = [];
  for (const id of [randomUUID(), other.data.deviceId]) {
    const path = `/devices/${id}`;
    responses.push(await useProof(user, path, await proof(user, 'DELETE', path), { method: 'DELETE' }));
  }
  assert.equal(responses[0].status, 404); assert.deepEqual(responses[0].body, responses[1].body);
  const inbox = await request(baseUrl, '/api/auth/security-notifications', { headers: authHeaders(user.accessToken) });
  const notification = inbox.body.data.find(n => n.action === 'security.session.revoke_others');
  assert.ok(notification.message.includes('mevcut oturum'));
  const foreignRead = await request(baseUrl, `/api/auth/security-notifications/${notification.id}/read`, { method: 'POST', headers: authHeaders(other.accessToken) });
  assert.equal(foreignRead.status, 200);
  assert.equal((await prisma.securityNotification.findUnique({ where: { id: notification.id } })).readAt, null);
  await request(baseUrl, `/api/auth/security-notifications/${notification.id}/read`, { method: 'POST', headers: authHeaders(user.accessToken) });
  assert.ok((await prisma.securityNotification.findUnique({ where: { id: notification.id } })).readAt);
});

test('notification failure rolls back security changes; proof consumption is final and retry needs a fresh proof', async () => {
  const user = await registerUser(baseUrl);
  const path = `/devices/${user.data.deviceId}`;
  const issued = await proof(user, 'PATCH', path);
  const original = prisma.$transaction.bind(prisma);
  prisma.$transaction = (operation, options) => original(async tx => {
    tx.securityNotification.create = async () => { throw new Error('Injected notification failure'); };
    return operation(tx);
  }, options);
  try { assert.equal((await useProof(user, path, issued, { method: 'PATCH', body: { deviceName: 'must-roll-back' } })).status, 500); }
  finally { prisma.$transaction = original; }
  assert.notEqual((await prisma.device.findUnique({ where: { id: user.data.deviceId } })).deviceName, 'must-roll-back');
  assert.equal((await useProof(user, path, issued, { method: 'PATCH', body: { deviceName: 'retry' } })).status, 403);
});

test('durable account and IP limits survive a new app instance, ignore forged email, and fail closed on storage failure', async () => {
  await prisma.abuseBucket.deleteMany();
  const user = await registerUser(baseUrl);
  for (let attempt=0; attempt<10; attempt++) assert.equal((await proof(user, 'POST', '/auth/export-authorize', { authHash: 'wrong' })).status, 403);
  const childScript = `const { DurableLimitStore } = await import(${JSON.stringify(new URL('../dist/middleware/durable-limit.js', import.meta.url).href)});
    const { prisma } = await import(${JSON.stringify(new URL('../dist/config/prisma.js', import.meta.url).href)});
    const result = await new DurableLimitStore('reauth-account').increment(${JSON.stringify(user.data.user.id)});
    console.log(JSON.stringify({ totalHits: result.totalHits })); await prisma.$disconnect();`;
  const child = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', childScript], { env: process.env });
  assert.equal(JSON.parse(child.stdout.trim()).totalHits, 11, 'a fresh process reads the durable account budget');
  await stopTestServer(server); ({ server, baseUrl } = await startTestServer({ resetLimits: false }));
  const limited = await proof(user, 'POST', '/auth/export-authorize');
  assert.equal(limited.status, 429); assert.ok(limited.headers.get('retry-after'));
  const other = await registerUser(baseUrl);
  assert.equal((await proof(other, 'POST', '/auth/export-authorize')).status, 200);
  // One IP cannot cycle accounts to evade its independent budget.
  const { DurableLimitStore } = await import('../dist/middleware/durable-limit.js');
  const store = new DurableLimitStore('reauth-ip');
  await Promise.all(Array.from({ length: 50 }, () => store.increment('127.0.0.1')));
  assert.equal((await proof(other, 'POST', '/auth/export-authorize')).status, 429);
  await prisma.abuseBucket.deleteMany();
  const original = prisma.$queryRaw;
  prisma.$queryRaw = async () => { throw new Error('Injected limiter database outage'); };
  try { assert.equal((await proof(other, 'POST', '/auth/export-authorize')).status, 500); }
  finally { prisma.$queryRaw = original; }
  const keys = await prisma.abuseBucket.findMany();
  assert.ok(keys.every(row => !row.key.includes('@') && !row.key.includes('127.0.0.1')));
});

test('account deletion requires proof and cascades sessions/proofs/notifications', async () => {
  await prisma.abuseBucket.deleteMany();
  const user = await registerUser(baseUrl);
  const issued = await proof(user, 'POST', '/auth/delete-account');
  assert.equal((await useProof(user, '/auth/delete-account', issued, { method: 'POST', body: { authHash: user.payload.authHash } })).status, 200);
  assert.equal(await prisma.user.count({ where: { id: user.data.user.id } }), 0);
  for (const table of ['device','reauthentication','securityNotification']) assert.equal(await prisma[table].count({ where: { userId: user.data.user.id } }), 0);
  assert.equal((await request(baseUrl, '/api/auth/me', { headers: authHeaders(user.accessToken) })).status, 401);
});

test('IPv6 equivalent addresses and rotating addresses within one /64 share durable IP budgets', async () => {
  const { DurableLimitStore, normalizeLimitIdentity } = await import('../dist/middleware/durable-limit.js');
  assert.equal(normalizeLimitIdentity('::ffff:127.0.0.1'), '127.0.0.1');
  const store = new DurableLimitStore('ipv6-test');
  assert.equal((await store.increment('2001:db8:1:2::1')).totalHits, 1);
  assert.equal((await store.increment('2001:0db8:0001:0002:abcd::9')).totalHits, 2);
  assert.equal((await store.increment('2001:db8:1:3::1')).totalHits, 1);
});

test('web deletion proof obeys CSRF protection, clears HttpOnly cookies, and deletes the account', async () => {
  await prisma.abuseBucket.deleteMany();
  const email = `web-delete-${randomUUID()}@example.integration.test`;
  const web = { 'x-vaultmaster-client': 'web', origin: 'http://localhost:3000' };
  const registered = await request(baseUrl, '/api/auth/register', { method: 'POST', headers: web,
    body: { email, authHash: 'synthetic-web-delete-auth', kdfSalt: email, kdfIterations: 600000 } });
  assert.equal(registered.status, 201);
  const cookie = registered.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const issued = await request(baseUrl, '/api/auth/reauthenticate', { method: 'POST', headers: { ...web, cookie },
    body: { method: 'POST', path: '/auth/delete-account', authHash: 'synthetic-web-delete-auth' } });
  assert.equal(issued.status, 200);
  const headers = { ...web, cookie, 'x-vaultmaster-reauth': issued.body.data.proof };
  assert.equal((await request(baseUrl, '/api/auth/delete-account', { method: 'POST', headers: { ...headers, origin: 'https://untrusted.example' }, body: { authHash: 'synthetic-web-delete-auth' } })).status, 403);
  const removed = await request(baseUrl, '/api/auth/delete-account', { method: 'POST', headers, body: { authHash: 'synthetic-web-delete-auth' } });
  assert.equal(removed.status, 200);
  assert.ok(removed.headers.getSetCookie().every(value => value.includes('HttpOnly') && value.includes('Secure') && value.includes('1970')));
  assert.equal(await prisma.user.count({ where: { email } }), 0);
});
