import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { authHeaders, registerUser, request, startTestServer, stopTestServer } from './integration-helpers.mjs';

test('device-bound password unlock verifies even an empty legacy vault without creating another session', async () => {
  const { server, baseUrl } = await startTestServer();
  const { prisma } = await import('../dist/config/prisma.js');
  let user;
  try {
    user = await registerUser(baseUrl);
    const endpoint = '/api/auth/unlock';
    assert.equal((await request(baseUrl, endpoint, { method: 'POST', body: { authHash: user.payload.authHash } })).status, 401);
    assert.equal((await request(baseUrl, endpoint, { method: 'POST', headers: authHeaders(user.accessToken), body: { authHash: 'wrong-proof' } })).status, 403);
    const unlocked = await request(baseUrl, endpoint, { method: 'POST', headers: authHeaders(user.accessToken), body: { authHash: user.payload.authHash } });
    assert.equal(unlocked.status, 200); assert.equal(unlocked.body.data.vaultKeyEnvelope, null);
    assert.equal(unlocked.headers.get('cache-control'), 'no-store');
    assert.equal(await prisma.device.count({ where: { userId: user.data.user.id } }), 1);
    await prisma.device.deleteMany({ where: { userId: user.data.user.id } });
    assert.equal((await request(baseUrl, endpoint, { method: 'POST', headers: authHeaders(user.accessToken), body: { authHash: user.payload.authHash } })).status, 401);
  } finally { if (user?.data?.user) await prisma.user.delete({ where: { id: user.data.user.id } }); await stopTestServer(server); }
});

test('WebAuthn accepts a signed assertion only from an explicitly allowed extension origin', async () => {
  const { server, baseUrl } = await startTestServer();
  const { prisma } = await import('../dist/config/prisma.js');
  const { env, parseEnv } = await import('../dist/config/env.js');
  const manifest = JSON.parse(await readFile(new URL('../../extension/src/manifest.json', import.meta.url), 'utf8'));
  const extensionId = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32)
    .replace(/[0-9a-f]/g, value => String.fromCharCode(97 + Number.parseInt(value, 16)));
  const allowedOrigin = `chrome-extension://${extensionId}`;
  const previous = env.WEBAUTHN_EXTENSION_ORIGINS;
  env.WEBAUTHN_EXTENSION_ORIGINS = allowedOrigin;
  let user;
  try {
    assert.throws(() => parseEnv({ ...process.env, WEBAUTHN_EXTENSION_ORIGINS: 'chrome-extension://*' }));
    user = await registerUser(baseUrl);
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = publicKey.export({ format: 'jwk' });
    const cose = Buffer.concat([Buffer.from('a5010203262001215820', 'hex'), Buffer.from(jwk.x, 'base64url'), Buffer.from('225820', 'hex'), Buffer.from(jwk.y, 'base64url')]);
    const credentialId = randomBytes(32).toString('base64url');
    await prisma.webAuthnCredential.create({ data: { userId: user.data.user.id, credentialId, publicKey: cose.toString('base64url'), counter: 0, transports: ['internal'] } });
    for (const purpose of ['login', 'reauthenticate']) {
      for (const origin of ['chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', allowedOrigin]) {
        const endpoint = `/api/auth/${purpose}`;
        const fields = purpose === 'login' ? { email: user.payload.email, vaultKeyProtocol: 1 } : { method: 'POST', path: '/auth/export-authorize' };
        const headers = purpose === 'login' ? {} : authHeaders(user.accessToken);
        const challenge = await request(baseUrl, endpoint, { method: 'POST', headers, body: { ...fields, authHash: user.payload.authHash } });
        assert.equal(challenge.body.data.requires2FA, true);
        const { options, challengeToken } = challenge.body.data.webAuthnOptions;
        const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin, crossOrigin: false }));
        const authenticatorData = Buffer.concat([createHash('sha256').update(options.rpId).digest(), Buffer.from([1, 0, 0, 0, purpose === 'login' ? 1 : 2])]);
        const signature = sign('sha256', Buffer.concat([authenticatorData, createHash('sha256').update(clientData).digest()]), privateKey);
        const response = await request(baseUrl, endpoint, { method: 'POST', headers, body: { ...fields, authHash: user.payload.authHash,
          webAuthnChallengeToken: challengeToken, webAuthnResponse: { id: credentialId, rawId: credentialId, type: 'public-key', clientExtensionResults: {},
            response: { clientDataJSON: clientData.toString('base64url'), authenticatorData: authenticatorData.toString('base64url'), signature: signature.toString('base64url') } } } });
        assert.equal(response.status, origin === allowedOrigin ? 200 : purpose === 'login' ? 401 : 403);
        if (purpose === 'reauthenticate' && origin === allowedOrigin) assert.ok(response.body.data.proof);
      }
    }
  } finally { env.WEBAUTHN_EXTENSION_ORIGINS = previous; if (user?.data?.user) await prisma.user.delete({ where: { id: user.data.user.id } }); await stopTestServer(server); }
});
