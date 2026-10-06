import test from 'node:test';
import assert from 'node:assert/strict';
import { registerUser, loginUser, authorizedRequest as request, startTestServer, stopTestServer } from './integration-helpers.mjs';
import { deriveMasterKey, createVaultKey, generateAuthHash, wrapVaultKey, unwrapVaultKey,
  encryptJSON, decryptJSON, encryptBinary, decryptBinary } from '../../../packages/crypto/dist/index.js';

test('legacy password changes preserve history, trash and attachment ciphertext atomically', async () => {
  const { server, baseUrl } = await startTestServer();
  const { prisma } = await import('../dist/config/prisma.js');
  let user;
  try {
    user = await registerUser(baseUrl);
    const oldKey = await deriveMasterKey('old-password', user.payload.email);
    const newKey = await deriveMasterKey('new-password', user.payload.email);
    const envelope = await wrapVaultKey(oldKey, newKey);
    const authHash = await generateAuthHash(newKey, 'new-password');
    const encrypted = await encryptJSON({ secret: 'preserve-every-version' }, oldKey);
    const blob = await encryptBinary(new Uint8Array([0, 12, 255]).buffer, oldKey);
    const active = await prisma.vaultItem.create({ data: { userId: user.data.user.id, encryptedData: encrypted.ciphertext, iv: encrypted.iv } });
    await prisma.vaultItem.create({ data: { userId: user.data.user.id, encryptedData: encrypted.ciphertext, iv: encrypted.iv, deletedAt: new Date() } });
    await prisma.vaultItemVersion.create({ data: { vaultItemId: active.id, encryptedData: encrypted.ciphertext, iv: encrypted.iv, favorite: false, reason: 'update' } });
    await prisma.attachment.create({ data: { vaultItemId: active.id, userId: user.data.user.id,
      encryptedMetadata: encrypted.ciphertext, metadataIv: encrypted.iv, encryptedBlob: blob.ciphertext, blobIv: blob.iv, size: 3 } });
    const snapshot = async () => ({
      items: await prisma.vaultItem.findMany({ where: { userId: user.data.user.id }, orderBy: { id: 'asc' } }),
      history: await prisma.vaultItemVersion.findMany({ where: { vaultItemId: active.id } }),
      files: await prisma.attachment.findMany({ where: { userId: user.data.user.id } }),
    });
    const before = await snapshot();
    const headers = { authorization: `Bearer ${user.accessToken}` };
    const change = { currentAuthHash: user.payload.authHash, newAuthHash: authHash, kdfIterations: 600000,
      expectedVaultKeyVersion: 0, vaultKeyEnvelope: envelope };
    // Reject the old destructive item-replacement protocol before any mutation.
    assert.equal((await request(baseUrl, '/api/auth/change-password', { method: 'POST', headers,
      body: { currentAuthHash: user.payload.authHash, newAuthHash: authHash, kdfIterations: 600000, items: [] } })).status, 400);
    assert.equal((await request(baseUrl, '/api/auth/change-password', { method: 'POST', headers, body: { ...change, currentAuthHash: 'wrong' } })).status, 403);
    assert.deepEqual(await snapshot(), before);
    const changed = await request(baseUrl, '/api/auth/change-password', { method: 'POST', headers, body: change });
    assert.equal(changed.status, 200);
    assert.equal(changed.body.data.vaultKeyEnvelope.version, 1);
    assert.deepEqual(await snapshot(), before);
    assert.equal((await loginUser(baseUrl, user.payload)).response.status, 401);
    const loggedIn = await loginUser(baseUrl, user.payload, { authHash });
    assert.equal(loggedIn.response.status, 200);
    const recovered = await unwrapVaultKey(loggedIn.data.vaultKeyEnvelope, newKey);
    for (const entry of [...before.items, ...before.history]) {
      assert.deepEqual(await decryptJSON(entry.encryptedData, entry.iv, recovered), { secret: 'preserve-every-version' });
    }
    const file = before.files[0];
    assert.deepEqual(await decryptJSON(file.encryptedMetadata, file.metadataIv, recovered), { secret: 'preserve-every-version' });
    assert.deepEqual(new Uint8Array(await decryptBinary(file.encryptedBlob, file.blobIv, recovered)), new Uint8Array([0, 12, 255]));
    const oldClient = await loginUser(baseUrl, user.payload, { authHash, vaultKeyProtocol: undefined });
    assert.equal(oldClient.response.status, 409);
    assert.equal((await request(baseUrl, '/api/auth/change-password', { method: 'POST', headers,
      body: { ...change, currentAuthHash: authHash } })).status, 409);
    assert.deepEqual(await snapshot(), before);
    // A second password change uses the new version, retaining the same DEK.
    const latestKey = await deriveMasterKey('latest-password', user.payload.email);
    const again = await request(baseUrl, '/api/auth/change-password', { method: 'POST', headers,
      body: { ...change, currentAuthHash: authHash, newAuthHash: await generateAuthHash(latestKey, 'latest-password'),
        expectedVaultKeyVersion: 1, vaultKeyEnvelope: await wrapVaultKey(recovered, latestKey) } });
    assert.equal(again.status, 200);
    assert.equal(again.body.data.vaultKeyEnvelope.version, 2);
    assert.deepEqual(await snapshot(), before);
  } finally {
    if (user?.data?.user) await prisma.user.delete({ where: { id: user.data.user.id } });
    await stopTestServer(server);
  }
});

test('new account envelopes round-trip and simultaneous password changes have exactly one winner', async () => {
  const { server, baseUrl } = await startTestServer();
  const { prisma } = await import('../dist/config/prisma.js');
  let user;
  try {
    const passwordKey = await deriveMasterKey('old-password', 'fixture@example.test');
    const vaultKey = await createVaultKey();
    const envelope = await wrapVaultKey(vaultKey, passwordKey);
    user = await registerUser(baseUrl, { vaultKeyEnvelope: envelope });
    assert.equal(user.response.status, 201);
    assert.deepEqual(user.data.vaultKeyEnvelope, { ...envelope, version: 1 });
    const result = await loginUser(baseUrl, user.payload);
    assert.deepEqual(result.data.vaultKeyEnvelope, user.data.vaultKeyEnvelope);
    const headers = { authorization: `Bearer ${user.accessToken}` };
    const responses = await Promise.all(['first', 'second'].map(newAuthHash => request(baseUrl, '/api/auth/change-password', {
      method: 'POST', headers, body: { currentAuthHash: user.payload.authHash, newAuthHash, kdfIterations: 600000,
        expectedVaultKeyVersion: 1, vaultKeyEnvelope: envelope },
    })));
    assert.equal(responses.filter(response => response.status === 200).length, 1);
    assert.ok(responses.some(response => [401, 403, 409].includes(response.status)));
    assert.equal((await prisma.user.findUnique({ where: { id: user.data.user.id } })).vaultKeyVersion, 2);
  } finally {
    if (user?.data?.user) await prisma.user.delete({ where: { id: user.data.user.id } });
    await stopTestServer(server);
  }
});

test('a login started with the old hash cannot create a session after password change', { timeout: 20000 }, async () => {
  const { server, baseUrl } = await startTestServer();
  const { prisma } = await import('../dist/config/prisma.js');
  const original = prisma.user.findUnique.bind(prisma.user);
  let release;
  let user;
  try {
    user = await registerUser(baseUrl);
    let read;
    const fetched = new Promise(resolve => { read = resolve; });
    const resume = new Promise(resolve => { release = resolve; });
    prisma.user.findUnique = async args => {
      const result = await original(args);
      if (args.where.email === user.payload.email) { read(); await resume; }
      return result;
    };
    const pendingLogin = loginUser(baseUrl, user.payload);
    await fetched;
    const envelope = await wrapVaultKey(await createVaultKey(), await deriveMasterKey('next', user.payload.email));
    const changed = await request(baseUrl, '/api/auth/change-password', { method: 'POST',
      headers: { authorization: `Bearer ${user.accessToken}` },
      body: { currentAuthHash: user.payload.authHash, newAuthHash: 'next-auth-hash', kdfIterations: 600000,
        expectedVaultKeyVersion: 0, vaultKeyEnvelope: envelope } });
    assert.equal(changed.status, 200);
    release();
    assert.equal((await pendingLogin).response.status, 401);
    assert.equal(await prisma.device.count({ where: { userId: user.data.user.id } }), 1);
  } finally {
    release?.();
    prisma.user.findUnique = original;
    if (user?.data?.user) await prisma.user.delete({ where: { id: user.data.user.id } });
    await stopTestServer(server);
  }
});
