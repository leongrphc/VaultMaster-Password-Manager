import test from 'node:test';
import assert from 'node:assert/strict';
import { createStoredPasskey, signStoredPasskey } from '../../../packages/crypto/dist/index.js';
import { authHeaders, cleanupIntegrationUsers, disconnectPrisma, registerUser, loginUser, request, authorizedRequest, startTestServer, stopTestServer } from './integration-helpers.mjs';
let server, baseUrl;
test.before(async () => { await cleanupIntegrationUsers(); ({ server, baseUrl } = await startTestServer()); });
test.after(async () => { await stopTestServer(server); await cleanupIntegrationUsers(); await disconnectPrisma(); });
const origin = 'http://localhost:3000';
const convert = options => ({ challenge: options.challenge, origin, rpId: options.rp?.id || options.rpId, user: options.user ? { id: options.user.id, name: options.user.name } : undefined,
  allowCredentials: options.allowCredentials?.map(entry => entry.id), excludeCredentials: options.excludeCredentials?.map(entry => entry.id) });
async function setup() {
  const user = await registerUser(baseUrl);
  const options = await authorizedRequest(baseUrl, '/api/auth/webauthn/registration/options', { method: 'POST', headers: authHeaders(user.accessToken) });
  assert.equal(options.status, 200);
  const created = await createStoredPasskey(convert(options.body.data.options), []);
  return { user, options: options.body.data, ...created };
}
async function registration(fixture, overrides = {}, token = fixture.user.accessToken) {
  return authorizedRequest(baseUrl, '/api/auth/webauthn/registration/verify', { method: 'POST', headers: authHeaders(token), body: { name: 'Synthetic vault authenticator', response: fixture.response,
    challengeToken: fixture.options.challengeToken, ...overrides } });
}
test('server verifies software registration/signing, account binding and one-use login challenge; vault remains ciphertext', async () => {
  const fixture = await setup();
  assert.equal((await registration(fixture)).status, 201);
  const login = await loginUser(baseUrl, fixture.user.payload);
  assert.equal(login.data.requires2FA, true);
  const options = login.data.webAuthnOptions;
  const signed = await signStoredPasskey(convert(options.options), fixture.stored);
  const accepted = await loginUser(baseUrl, fixture.user.payload, { webAuthnResponse: signed, webAuthnChallengeToken: options.challengeToken });
  assert.equal(accepted.response.status, 200); assert.ok(accepted.accessToken);
  const replay = await loginUser(baseUrl, fixture.user.payload, { webAuthnResponse: signed, webAuthnChallengeToken: options.challengeToken });
  assert.equal(replay.response.status, 401);
  const foreign = await registerUser(baseUrl);
  const foreignOptions = await import('../dist/routes/webauthn.routes.js').then(module => module.createWebAuthnLoginOptions(foreign.data.user.id));
  const foreignAssertion = await signStoredPasskey(convert({ ...foreignOptions.options, allowCredentials: [{ id: fixture.stored.credentialId }] }), fixture.stored);
  const verifyLogin = (await import('../dist/routes/webauthn.routes.js')).verifyWebAuthnLogin;
  assert.equal(await verifyLogin(foreign.data.user.id, foreignAssertion, foreignOptions.challengeToken), false);
  const { prisma } = await import('../dist/config/prisma.js');
  const audits = await prisma.auditEvent.findMany({ where: { userId: fixture.user.data.user.id } });
  const serialized = JSON.stringify(audits);
  for (const value of [fixture.stored.credentialId, fixture.stored.privateKey, fixture.response.response.attestationObject, signed.response.clientDataJSON]) assert.ok(!serialized.includes(value));
});
test('registration challenges reject another device, account, replay, origin and RP hash mismatch', async () => {
  for (const kind of ['device', 'account', 'origin', 'rp']) {
    const fixture = await setup();
    let token = fixture.user.accessToken;
    if (kind === 'device') token = (await loginUser(baseUrl, fixture.user.payload)).accessToken;
    if (kind === 'account') token = (await registerUser(baseUrl)).accessToken;
    if (kind === 'origin') {
      const bytes = JSON.parse(Buffer.from(fixture.response.response.clientDataJSON, 'base64url'));
      bytes.origin = 'https://evil.test'; fixture.response.response.clientDataJSON = Buffer.from(JSON.stringify(bytes)).toString('base64url');
    }
    if (kind === 'rp') {
      fixture.response = (await createStoredPasskey({ ...convert(fixture.options.options), rpId: 'evil.test', origin: 'https://evil.test' }, [])).response;
      // Keep the expected client origin, so rejection exercises authenticator RP hash.
      const bytes = JSON.parse(Buffer.from(fixture.response.response.clientDataJSON, 'base64url')); bytes.origin = origin;
      fixture.response.response.clientDataJSON = Buffer.from(JSON.stringify(bytes)).toString('base64url');
    }
    assert.equal((await registration(fixture, {}, token)).status, 400);
    assert.equal((await registration(fixture)).status, 400);
  }
});
async function factorProof(fixture, method, path) {
  const headers = authHeaders(fixture.user.accessToken);
  const body = { method, path, authHash: fixture.user.payload.authHash };
  const start = await request(baseUrl, '/api/auth/reauthenticate', { method: 'POST', headers, body });
  assert.equal(start.status, 200);
  const ceremony = start.body.data.webAuthnOptions;
  const assertion = await signStoredPasskey(convert(ceremony.options), fixture.stored);
  const proof = await request(baseUrl, '/api/auth/reauthenticate', { method: 'POST', headers, body: { ...body, webAuthnResponse: assertion, webAuthnChallengeToken: ceremony.challengeToken } });
  assert.equal(proof.status, 200); assert.ok(proof.body.data.proof);
  return { ...headers, 'x-vaultmaster-reauth': proof.body.data.proof };
}
test('duplicate registration fails generically and emits no success; registration and reauthentication reject replay and ceremony mixing', async () => {
  const fixture = await setup(); assert.equal((await registration(fixture)).status, 201);
  const path = '/auth/webauthn/registration/options';
  const next = await request(baseUrl, '/api' + path, { method: 'POST', headers: await factorProof(fixture, 'POST', path) });
  assert.equal(next.status, 200);
  // None attestation has no attestation signature; replaying the authenticator
  // identity with new client data must still hit the global unique constraint.
  const response = structuredClone(fixture.response);
  const client = JSON.parse(Buffer.from(response.response.clientDataJSON, 'base64url')); client.challenge = next.body.data.options.challenge;
  response.response.clientDataJSON = Buffer.from(JSON.stringify(client)).toString('base64url');
  const verifyPath = '/auth/webauthn/registration/verify';
  const duplicate = await request(baseUrl, '/api' + verifyPath, { method: 'POST', headers: await factorProof(fixture, 'POST', verifyPath), body: { response, challengeToken: next.body.data.challengeToken } });
  assert.equal(duplicate.status, 400); assert.equal(duplicate.body.error, 'WebAuthn kaydı doğrulanamadı');
  const replay = await request(baseUrl, '/api' + verifyPath, { method: 'POST', headers: await factorProof(fixture, 'POST', verifyPath), body: { response, challengeToken: next.body.data.challengeToken } });
  assert.equal(replay.status, 400);
  const { prisma } = await import('../dist/config/prisma.js');
  assert.equal(await prisma.webAuthnCredential.count({ where: { userId: fixture.user.data.user.id } }), 1);
  assert.equal(await prisma.securityNotification.count({ where: { userId: fixture.user.data.user.id, action: 'security.webauthn.register' } }), 1);
  const fields = { method: 'POST', path: '/auth/export-authorize', authHash: fixture.user.payload.authHash };
  const challenge = await request(baseUrl, '/api/auth/reauthenticate', { method: 'POST', headers: authHeaders(fixture.user.accessToken), body: fields });
  const ceremony = challenge.body.data.webAuthnOptions;
  const assertion = await signStoredPasskey(convert(ceremony.options), fixture.stored);
  const mixed = await loginUser(baseUrl, fixture.user.payload, { webAuthnResponse: assertion, webAuthnChallengeToken: ceremony.challengeToken });
  assert.equal(mixed.response.status, 401);
  const replayProof = await request(baseUrl, '/api/auth/reauthenticate', { method: 'POST', headers: authHeaders(fixture.user.accessToken), body: { ...fields, webAuthnResponse: assertion, webAuthnChallengeToken: ceremony.challengeToken } });
  assert.equal(replayProof.status, 403);
});
test('reauthentication assertions bind the device and operation, and wrong user handles fail', async () => {
  const fixture = await setup(); assert.equal((await registration(fixture)).status, 201);
  const loginStart = await loginUser(baseUrl, fixture.user.payload);
  const loginCeremony = loginStart.data.webAuthnOptions;
  const validLogin = await signStoredPasskey(convert(loginCeremony.options), fixture.stored);
  const other = await loginUser(baseUrl, fixture.user.payload, { webAuthnResponse: validLogin, webAuthnChallengeToken: loginCeremony.challengeToken });
  assert.ok(other.accessToken);
  for (const kind of ['device', 'target', 'handle']) {
    const fields = { method: 'POST', path: '/auth/export-authorize', authHash: fixture.user.payload.authHash };
    const start = await request(baseUrl, '/api/auth/reauthenticate', { method: 'POST', headers: authHeaders(fixture.user.accessToken), body: fields });
    const ceremony = start.body.data.webAuthnOptions;
    const signed = await signStoredPasskey(convert(ceremony.options), fixture.stored);
    if (kind === 'handle') signed.response.userHandle = Buffer.from('foreign-user').toString('base64url');
    const denied = await request(baseUrl, '/api/auth/reauthenticate', { method: 'POST', headers: authHeaders(kind === 'device' ? other.accessToken : fixture.user.accessToken),
      body: { ...fields, ...(kind === 'target' ? { path: '/auth/2fa/setup' } : {}), webAuthnResponse: signed, webAuthnChallengeToken: ceremony.challengeToken } });
    assert.equal(denied.status, 403);
    if (kind === 'device') {
    const replay = await request(baseUrl, '/api/auth/reauthenticate', { method: 'POST', headers: authHeaders(fixture.user.accessToken), body: { ...fields, webAuthnResponse: signed, webAuthnChallengeToken: ceremony.challengeToken } });
    assert.equal(replay.status, 403);
    }
  }
});
test('concurrent native-style counters cannot move the stored counter backwards', { timeout: 5000 }, async () => {
  const fixture = await setup(); assert.equal((await registration(fixture)).status, 201);
  const { prisma } = await import('../dist/config/prisma.js');
  const { createWebAuthnLoginOptions, verifyWebAuthnLogin } = await import('../dist/routes/webauthn.routes.js');
  const { createHash, createPrivateKey, sign } = await import('node:crypto');
  const envelope = JSON.parse(fixture.stored.privateKey.slice('vm-passkey-v1:'.length));
  const privateKey = createPrivateKey({ key: Buffer.from(envelope.pkcs8, 'base64url'), type: 'pkcs8', format: 'der' });
  const ceremonies = await Promise.all([createWebAuthnLoginOptions(fixture.user.data.user.id), createWebAuthnLoginOptions(fixture.user.data.user.id)]);
  const assertions = ceremonies.map((ceremony, index) => {
    const client = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: ceremony.options.challenge, origin, crossOrigin: false }));
    const auth = Buffer.concat([createHash('sha256').update('localhost').digest(), Buffer.from([9, 0, 0, 0, index + 1])]);
    return { id: fixture.stored.credentialId, rawId: fixture.stored.credentialId, type: 'public-key', clientExtensionResults: {}, response: {
      clientDataJSON: client.toString('base64url'), authenticatorData: auth.toString('base64url'), userHandle: fixture.stored.userHandle,
      signature: sign('sha256', Buffer.concat([auth, createHash('sha256').update(client).digest()]), privateKey).toString('base64url') } };
  });
  const original = prisma.webAuthnCredential.updateMany.bind(prisma.webAuthnCredential);
  let release, reached;
  const held = new Promise(resolve => { release = resolve; }), pending = new Promise(resolve => { reached = resolve; });
  prisma.webAuthnCredential.updateMany = async input => {
    if (input.data.counter === 1) { reached(); await held; }
    return original(input);
  };
  try {
    const first = verifyWebAuthnLogin(fixture.user.data.user.id, assertions[0], ceremonies[0].challengeToken);
    await pending;
    assert.equal(await verifyWebAuthnLogin(fixture.user.data.user.id, assertions[1], ceremonies[1].challengeToken), true);
    release(); assert.equal(await first, false);
    assert.equal((await prisma.webAuthnCredential.findUnique({ where: { credentialId: fixture.stored.credentialId } })).counter, 2);
  } finally { release(); prisma.webAuthnCredential.updateMany = original; }
});
