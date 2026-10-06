import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptChunkedBackup, decryptChunkedBackup, encryptBackup, decryptBackup,
  BACKUP_CHUNK_BYTES, MAX_CHUNKED_BACKUP_BYTES } from '../dist/index.js';
const password = 'independent-backup-password';
let file;
const payload = { secret: 'private', data: 'ü'.repeat(BACKUP_CHUNK_BYTES) };
test.before(async () => { file = await encryptChunkedBackup(payload, password); });
test('v4 multi-chunk UTF-8 round-trip and v3 compatibility', async () => {
  assert.deepEqual(await decryptChunkedBackup(file, password), payload);
  assert.ok(!JSON.stringify(file).includes('private'));
  assert.deepEqual(await decryptBackup(await encryptBackup(payload, password), password), payload);
});
test('v4 rejects password, ciphertext, IV and authenticated header tampering', async () => {
  await assert.rejects(decryptChunkedBackup(file, 'wrong-password'));
  for (const mutate of [f => { f.chunks[0].ciphertext = '!' + f.chunks[0].ciphertext.slice(1); },
    f => { f.chunks[0].iv = 'AAAAAAAAAAAAAAAA'; }, f => { f.kdf.salt = 'A'.repeat(43) + '='; },
    f => { f.totalBytes--; }, f => { f.kdf.iterations = 1; }, f => { f.version = 99; }]) {
    const changed = structuredClone(file); mutate(changed);
    await assert.rejects(decryptChunkedBackup(changed, password));
  }
});
test('v4 rejects reordered, relabelled, duplicated, missing and extra chunks', async () => {
  for (const mutate of [f => f.chunks.reverse(), f => { [f.chunks[0], f.chunks[1]] = [f.chunks[1], f.chunks[0]]; f.chunks.forEach((c, i) => c.index = i); },
    f => { f.chunks[1] = f.chunks[0]; }, f => f.chunks.pop(), f => f.chunks.push(f.chunks[0])]) {
    const changed = structuredClone(file); mutate(changed);
    await assert.rejects(decryptChunkedBackup(changed, password));
  }
});
test('v4 enforces total/chunk limits before KDF and rejects oversized export', async () => {
  await assert.rejects(decryptChunkedBackup({ ...file, totalBytes: MAX_CHUNKED_BACKUP_BYTES + 1 }, password));
  await assert.rejects(decryptChunkedBackup({ ...file, chunkBytes: BACKUP_CHUNK_BYTES + 1 }, password));
  await assert.rejects(encryptChunkedBackup('x'.repeat(MAX_CHUNKED_BACKUP_BYTES), password), /size limit/);
});
test('v4 stops encryption when the vault operation is invalidated', async () => {
  let calls = 0;
  await assert.rejects(encryptChunkedBackup(payload, password, () => { if (++calls === 3) throw new Error('locked'); }), /locked/);
});
