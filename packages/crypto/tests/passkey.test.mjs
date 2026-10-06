import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, verify } from 'node:crypto';
import { createStoredPasskey, signStoredPasskey, passkeyBytes, encryptJSON, decryptJSON, createVaultKey, wrapVaultKey, unwrapVaultKey } from '../dist/index.js';
const challenge = Buffer.alloc(32, 7).toString('base64url');
const request = { origin: 'https://example.test', rpId: 'example.test', challenge, user: { id: Buffer.from('synthetic-user').toString('base64url'), name: 'Synthetic' } };
test('ES256 signing verifies RP hash, client data and DER signature; portable encrypted recovery preserves bindings', async () => {
  const { stored, response } = await createStoredPasskey(request, []);
  assert.equal(response.type, 'public-key');
  assert.equal(passkeyBytes(response.response.authenticatorData)[32], 0x49);
  const key = await createVaultKey(), wrapping = await createVaultKey();
  const encrypted = await encryptJSON(stored, key);
  assert.ok(!JSON.stringify(encrypted).includes(stored.privateKey));
  const recoveredKey = await unwrapVaultKey(await wrapVaultKey(key, wrapping), wrapping);
  const recovered = await decryptJSON(encrypted.ciphertext, encrypted.iv, recoveredKey);
  assert.deepEqual(recovered, stored);
  const assertion = await signStoredPasskey({ ...request, user: undefined, allowCredentials: [stored.credentialId] }, recovered);
  const client = Buffer.from(assertion.response.clientDataJSON, 'base64url');
  const auth = Buffer.from(assertion.response.authenticatorData, 'base64url');
  assert.equal(auth[32], 9); assert.equal(auth.readUInt32BE(33), 0);
  const { createHash } = await import('node:crypto');
  assert.deepEqual(auth.subarray(0,32), createHash('sha256').update(request.rpId).digest());
  const envelope = JSON.parse(stored.privateKey.slice('vm-passkey-v1:'.length));
  const publicKey = createPublicKey({ key: Buffer.from(envelope.pkcs8, 'base64url'), type: 'pkcs8', format: 'der' });
  assert.equal(verify('sha256', Buffer.concat([auth, createHash('sha256').update(client).digest()]), publicKey, Buffer.from(assertion.response.signature, 'base64url')), true);
  assert.equal(JSON.parse(client).crossOrigin, false);
});
test('rejects malformed requests, scope/allow-list mismatch, legacy keys, edited bindings and excluded duplicates', async () => {
  const { stored } = await createStoredPasskey(request, []);
  for (const invalid of [{ rpId: 'test' }, { origin: 'https://evil.test' }, { origin: 'http://example.test' }, { challenge: 'a' }, { challenge: challenge + '=' }]) {
    await assert.rejects(createStoredPasskey({ ...request, ...invalid }, []));
  }
  await assert.rejects(createStoredPasskey({ ...request, excludeCredentials: [stored.credentialId] }, [stored]));
  for (const invalid of [{ rpId: 'evil.test', origin: 'https://evil.test' }, { origin: 'https://example.test:8443' }, { allowCredentials: [Buffer.alloc(32, 8).toString('base64url')] }]) {
    await assert.rejects(signStoredPasskey({ ...request, ...invalid }, stored));
  }
  for (const invalid of [{ privateKey: 'legacy' }, { credentialId: 'edited' }, { userHandle: 'edited' }, { publicKey: 'edited' }]) {
    await assert.rejects(signStoredPasskey(request, { ...stored, ...invalid }));
  }
});
