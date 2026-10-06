import test from 'node:test';
import assert from 'node:assert/strict';
import { createVaultKey, deriveMasterKey, wrapVaultKey, unwrapVaultKey, exportMasterKeyBase64 } from '../dist/index.js';

// Security counterexample, not a proposed offline format. Authentication of
// ciphertext cannot establish freshness, device validity or password revocation.
test('an authentic old wrapper still decrypts the stable DEK after password rewrap and profile replay', async () => {
  const key = await createVaultKey();
  const oldPasswordKey = await deriveMasterKey('synthetic-old-password', 'offline@example.test');
  const newPasswordKey = await deriveMasterKey('synthetic-new-password', 'offline@example.test');
  const oldWrapper = await wrapVaultKey(key, oldPasswordKey);
  const newWrapper = await wrapVaultKey(key, newPasswordKey);
  assert.notEqual(oldWrapper.ciphertext, newWrapper.ciphertext);
  const expected = await exportMasterKeyBase64(key);
  assert.equal(await exportMasterKeyBase64(await unwrapVaultKey(newWrapper, newPasswordKey)), expected);
  // Copying a browser profile or backup can restore this unchanged old wrapper.
  assert.equal(await exportMasterKeyBase64(await unwrapVaultKey(structuredClone(oldWrapper), oldPasswordKey)), expected);
  await assert.rejects(unwrapVaultKey(oldWrapper, newPasswordKey));
});
