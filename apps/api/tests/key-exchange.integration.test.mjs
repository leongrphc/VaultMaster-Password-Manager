import test from 'node:test';
import assert from 'node:assert/strict';
import { createExchangeIdentity, contactFingerprint, sealExchange, openExchange, createVaultKey, wrapExchangeIdentity } from '../../../packages/crypto/dist/index.js';
import { authHeaders, authorizedRequest, request, registerUser, cleanupIntegrationUsers, disconnectPrisma, startTestServer, stopTestServer } from './integration-helpers.mjs';
let server, baseUrl, prisma;
test.before(async () => { ({ prisma } = await import('../dist/config/prisma.js')); await cleanupIntegrationUsers(); ({ server, baseUrl } = await startTestServer()); });
test.after(async () => { await stopTestServer(server); await cleanupIntegrationUsers(); await disconnectPrisma(); });
async function reset() { await prisma.abuseBucket.deleteMany(); }
async function call(user, path, body, method = 'POST', approved = true) { await reset(); return (approved ? authorizedRequest : request)(baseUrl, '/api/key-exchange' + path, { headers: authHeaders(user.accessToken), method, ...(body ? { body } : {}) }); }
async function enroll() {
  await reset(); const user = await registerUser(baseUrl), identity = await createExchangeIdentity(), dek = await createVaultKey();
  const device = await prisma.device.findFirstOrThrow({ where: { userId: user.data.user.id } });
  const wrapped = await wrapExchangeIdentity(identity, dek, device.id);
  assert.equal((await call(user, '/key', { card: identity.card, wrapped: wrapped.ciphertext, iv: wrapped.iv })).status, 201);
  return { ...user, identity, dek, device };
}
async function fixture(kind = 'share') {
  const sender = await enroll(), recipient = await enroll(), id = crypto.randomUUID();
  const context = { id, kind, sender: await contactFingerprint(sender.identity.card), recipient: await contactFingerprint(recipient.identity.card), expiresAt: new Date(Date.now() + 86400000).toISOString(), revision: 0 };
  const payload = { secret: 'synthetic-never-uploaded', key: crypto.randomUUID() };
  const envelope = kind === 'share' ? await sealExchange(payload, sender.identity, recipient.identity.card, context) : undefined;
  const body = { id, recipient: recipient.identity.card, kind, expiresAt: context.expiresAt, waitHours: 1, ...(envelope ? { envelope } : {}) };
  assert.equal((await call(sender, '', body)).status, 201);
  return { sender, recipient, id, context, payload, body };
}
test('explicit proofs and ciphertext-only immutable sharing, accepted-device scope and exact creation retries', async () => {
  const f = await fixture();
  assert.equal((await call(f.sender, '', f.body, 'POST', false)).status, 403);
  assert.equal((await call(f.sender, '', f.body)).status, 201);
  assert.equal(await prisma.exchangeGrant.count({ where: { id: f.id } }), 1);
  assert.equal((await call(f.recipient, `/${f.id}/open`, { revision: 0 })).status, 409);
  const accepted = await call(f.recipient, `/${f.id}/accept`, { revision: 0 }); assert.equal(accepted.status, 200);
  assert.equal((await call(f.recipient, `/${f.id}/accept`, { revision: 0 })).status, 409);
  const opened = await call(f.recipient, `/${f.id}/open`, { revision: 1 }); assert.equal(opened.status, 200);
  assert.deepEqual(await openExchange(opened.body.data.envelope, f.recipient.identity, f.sender.identity.card, f.context), f.payload);
  assert.ok(!JSON.stringify(await prisma.exchangeGrant.findUnique({ where: { id: f.id } })).includes(f.payload.secret));
  const outsider = await enroll(); assert.equal((await call(outsider, `/${f.id}/open`, { revision: 1 })).status, 409);
  assert.equal((await call(f.sender, '', { ...f.body, waitHours: 2 })).status, 409);
});
test('concurrent acceptance/revocation serialize and consumed proofs cannot replay', async () => {
  const f = await fixture();
  await reset();
  const proof = await request(baseUrl, '/api/auth/reauthenticate', { method: 'POST', headers: authHeaders(f.recipient.accessToken), body: { method: 'POST', path: `/key-exchange/${f.id}/accept`, authHash: f.recipient.payload.authHash } });
  const options = { method: 'POST', headers: { ...authHeaders(f.recipient.accessToken), 'x-vaultmaster-reauth': proof.body.data.proof }, body: { revision: 0 } };
  const result = await Promise.all([request(baseUrl, `/api/key-exchange/${f.id}/accept`, options), request(baseUrl, `/api/key-exchange/${f.id}/accept`, options)]);
  assert.deepEqual(result.map(r => r.status).sort(), [200, 403]);
  await reset();
  const replies = await Promise.all([call(f.sender, `/${f.id}/revoke`, { revision: 1 }), call(f.recipient, `/${f.id}/request`, { revision: 1 })]);
  assert.ok(replies.every(r => [200, 409].includes(r.status)));
  assert.equal((await call(f.recipient, `/${f.id}/open`, { revision: 2 })).status, 409);
  assert.equal((await prisma.exchangeGrant.findUniqueOrThrow({ where: { id: f.id } })).envelope, null);
});
test('emergency has no pre-grant secret, requires acceptance, request, wait and fresh signed owner approval', async () => {
  const f = await fixture('emergency');
  assert.equal((await prisma.exchangeGrant.findUniqueOrThrow({ where: { id: f.id } })).envelope, null);
  assert.equal((await call(f.recipient, `/${f.id}/request`, { revision: 0 })).status, 409);
  assert.equal((await call(f.recipient, `/${f.id}/accept`, { revision: 0 })).status, 200);
  assert.equal((await call(f.recipient, `/${f.id}/request`, { revision: 1 })).status, 200);
  const context = { ...f.context, revision: 3 };
  const envelope = await sealExchange(f.payload, f.sender.identity, f.recipient.identity.card, context);
  assert.equal((await call(f.sender, `/${f.id}/grant`, { revision: 2, envelope })).status, 409);
  await prisma.exchangeGrant.update({ where: { id: f.id }, data: { requestedAt: new Date(Date.now() - 3600001) } });
  assert.equal((await call(f.recipient, `/${f.id}/open`, { revision: 2 })).status, 409);
  assert.equal((await call(f.recipient, `/${f.id}/grant`, { revision: 2, envelope })).status, 409);
  assert.equal((await call(f.sender, `/${f.id}/grant`, { revision: 2, envelope })).status, 200);
  const opened = await call(f.recipient, `/${f.id}/open`, { revision: 3 });
  assert.equal(opened.status, 200); assert.deepEqual(await openExchange(opened.body.data.envelope, f.recipient.identity, f.sender.identity.card, context), f.payload);
  assert.equal((await call(f.sender, `/${f.id}/grant`, { revision: 2, envelope })).status, 409);
});
test('rejected emergency requests need a new request and cannot reuse old grant envelopes', async () => {
  const f = await fixture('emergency');
  await call(f.recipient, `/${f.id}/accept`, { revision: 0 }); await call(f.recipient, `/${f.id}/request`, { revision: 1 });
  assert.equal((await call(f.sender, `/${f.id}/reject`, { revision: 2 })).status, 200);
  assert.equal((await call(f.recipient, `/${f.id}/open`, { revision: 3 })).status, 409);
  assert.equal((await call(f.recipient, `/${f.id}/request`, { revision: 3 })).status, 200);
  const envelope = await sealExchange(f.payload, f.sender.identity, f.recipient.identity.card, { ...f.context, revision: 3 });
  await prisma.exchangeGrant.update({ where: { id: f.id }, data: { requestedAt: new Date(Date.now() - 3600001) } });
  assert.equal((await call(f.sender, `/${f.id}/grant`, { revision: 4, envelope })).status, 409);
});
test('expiry, key rotation, logged-out devices and deleted accounts make delivery unavailable', async () => {
  const f = await fixture(); await call(f.recipient, `/${f.id}/accept`, { revision: 0 });
  await prisma.exchangeGrant.update({ where: { id: f.id }, data: { expiresAt: new Date(0) } });
  assert.equal((await call(f.recipient, `/${f.id}/open`, { revision: 1 })).status, 409);
  const other = await fixture(); await call(other.recipient, `/${other.id}/accept`, { revision: 0 });
  assert.equal((await call(other.sender, '/key', undefined, 'DELETE')).status, 200);
  assert.equal((await call(other.recipient, `/${other.id}/open`, { revision: 1 })).status, 409);
  const loggedOut = await fixture(); await call(loggedOut.recipient, `/${loggedOut.id}/accept`, { revision: 0 });
  await prisma.device.update({ where: { id: loggedOut.sender.device.id }, data: { refreshTokenHash: null } });
  assert.equal((await call(loggedOut.recipient, `/${loggedOut.id}/open`, { revision: 1 })).status, 409);
  await prisma.user.delete({ where: { id: loggedOut.sender.data.user.id } });
  assert.equal(await prisma.exchangeGrant.count({ where: { id: loggedOut.id } }), 0);
});
test('unknown recipient cards and mismatched public keys give generic unavailable responses without email lookup', async () => {
  const f = await fixture();
  const unknown = (await createExchangeIdentity()).card;
  const missing = await call(f.sender, '', { ...f.body, id: crypto.randomUUID(), recipient: unknown });
  const edited = await call(f.sender, '', { ...f.body, id: crypto.randomUUID(), recipient: { ...f.recipient.identity.card, signing: unknown.signing } });
  assert.equal(missing.status, 409); assert.deepEqual(missing.body, edited.body);
  const listed = await call(f.recipient, '', undefined, 'GET');
  assert.equal(listed.body.data[0].envelope, undefined); assert.ok(!JSON.stringify(listed.body).includes('@'));
});
