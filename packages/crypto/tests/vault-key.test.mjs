import test from 'node:test';
import assert from 'node:assert/strict';
import { createVaultKey, deriveMasterKey, wrapVaultKey, unwrapVaultKey, exportMasterKeyBase64,
  encryptJSON, decryptJSON, encryptBinary, decryptBinary } from '../dist/index.js';

for (const legacy of [true, false]) {
  test(`password envelope changes preserve ${legacy ? 'legacy' : 'random'} data keys and all ciphertext`, async () => {
    const oldKey = await deriveMasterKey('old-password', 'user@example.test', 1);
    const nextKey = await deriveMasterKey('new-password', 'user@example.test', 1);
    const dataKey = legacy ? oldKey : await createVaultKey();
    const documents = await Promise.all(['active', 'history', 'trash', 'attachment-metadata', 'shared-key'].map(kind => encryptJSON({ kind }, dataKey)));
    const file = await encryptBinary(new Uint8Array([0, 1, 255]).buffer, dataKey);
    const envelope = await wrapVaultKey(dataKey, nextKey);
    const recovered = await unwrapVaultKey(envelope, nextKey);
    assert.equal(await exportMasterKeyBase64(recovered), await exportMasterKeyBase64(dataKey));
    for (const [i, encrypted] of documents.entries()) {
      assert.deepEqual(await decryptJSON(encrypted.ciphertext, encrypted.iv, recovered), { kind: ['active', 'history', 'trash', 'attachment-metadata', 'shared-key'][i] });
    }
    assert.deepEqual(new Uint8Array(await decryptBinary(file.ciphertext, file.iv, recovered)), new Uint8Array([0, 1, 255]));
    await assert.rejects(unwrapVaultKey(envelope, oldKey));
    await assert.rejects(unwrapVaultKey({ ...envelope, ciphertext: (envelope.ciphertext[0] === 'A' ? 'B' : 'A') + envelope.ciphertext.slice(1) }, nextKey));
    const another = await wrapVaultKey(dataKey, nextKey);
    assert.notEqual(another.iv, envelope.iv);
    assert.notEqual(another.ciphertext, envelope.ciphertext);
  });
}
