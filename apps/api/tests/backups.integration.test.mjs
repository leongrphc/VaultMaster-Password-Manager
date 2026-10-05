import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { registerUser, request, startTestServer, stopTestServer } from './integration-helpers.mjs';
import { createVaultKey, exportMasterKeyBase64, encryptJSON, encryptBinary, decryptJSON, decryptBinary,
  encryptBackup, decryptBackup } from '../../../packages/crypto/dist/index.js';

test('full personal backup restores after source deletion, preserves existing data and retries without duplicates', async () => {
  const { server, baseUrl } = await startTestServer();
  const { prisma } = await import('../dist/config/prisma.js');
  let source, target;
  try {
    source = await registerUser(baseUrl);
    target = await registerUser(baseUrl);
    const sourceKey = await createVaultKey(), targetKey = await createVaultKey();
    const date = new Date('2026-01-02T03:04:05.000Z');
    const payload = { type: 'login', title: 'Recoverable', password: 'fixture-secret' };
    const data = await encryptJSON(payload, sourceKey);
    const blob = await encryptBinary(new Uint8Array([0, 1, 255]).buffer, sourceKey);
    const folder = await prisma.folder.create({ data: { userId: source.data.user.id, name: 'Source folder', createdAt: date, updatedAt: date } });
    const active = await prisma.vaultItem.create({ data: { userId: source.data.user.id, folderId: folder.id,
      encryptedData: data.ciphertext, iv: data.iv, favorite: true, createdAt: date, updatedAt: date } });
    await prisma.vaultItem.create({ data: { userId: source.data.user.id, folderId: folder.id,
      encryptedData: data.ciphertext, iv: data.iv, deletedAt: date, createdAt: date, updatedAt: date } });
    await prisma.vaultItemVersion.create({ data: { vaultItemId: active.id, encryptedData: data.ciphertext, iv: data.iv,
      folderId: randomUUID(), favorite: false, reason: 'update', createdAt: date } });
    await prisma.attachment.create({ data: { userId: source.data.user.id, vaultItemId: active.id,
      encryptedMetadata: data.ciphertext, metadataIv: data.iv, encryptedBlob: blob.ciphertext, blobIv: blob.iv,
      size: 3, createdAt: date, updatedAt: date } });
    const existing = await prisma.vaultItem.create({ data: { userId: target.data.user.id, encryptedData: 'existing', iv: 'existing-iv' } });
    const headers = { authorization: `Bearer ${source.accessToken}` };
    assert.equal((await request(baseUrl, '/api/backups/snapshot')).status, 401);
    const snapshot = await request(baseUrl, '/api/backups/snapshot', { headers });
    assert.equal(snapshot.status, 200);
    assert.equal(snapshot.body.data.snapshot.items.length, 2);
    assert.ok(!JSON.stringify(snapshot.body).includes(source.payload.authHash));
    assert.ok(!JSON.stringify(snapshot.body).includes('existing-iv'));
    const portable = await encryptBackup({ ...snapshot.body.data, sourceKey: await exportMasterKeyBase64(sourceKey) }, 'independent-backup-password');
    await prisma.user.delete({ where: { id: source.data.user.id } });
    source = null;
    const recovered = await decryptBackup(portable, 'independent-backup-password');
    // Simulate the client decrypting every content type then encrypting for the
    // destination. The restore API receives no source key or plaintext secret.
    const body = { backupId: recovered.backupId, snapshot: recovered.snapshot };
    const reencrypt = async (ciphertext, iv) => {
      const value = await decryptJSON(ciphertext, iv, sourceKey);
      const next = await encryptJSON(value, targetKey);
      return { encryptedData: next.ciphertext, iv: next.iv };
    };
    for (const item of body.snapshot.items) {
      Object.assign(item, await reencrypt(item.encryptedData, item.iv));
      for (const version of item.versions) Object.assign(version, await reencrypt(version.encryptedData, version.iv));
      for (const file of item.attachments) {
        const metadata = await reencrypt(file.encryptedMetadata, file.metadataIv);
        const blob = await encryptBinary(await decryptBinary(file.encryptedBlob, file.blobIv, sourceKey), targetKey);
        Object.assign(file, { encryptedMetadata: metadata.encryptedData, metadataIv: metadata.iv, encryptedBlob: blob.ciphertext, blobIv: blob.iv });
      }
    }
    assert.ok(!JSON.stringify(body).includes('fixture-secret'));
    const targetHeaders = { authorization: `Bearer ${target.accessToken}` };
    const [first, retry] = await Promise.all([1, 2].map(() => request(baseUrl, '/api/backups/restore', { method: 'POST', headers: targetHeaders, body })));
    assert.equal(first.status, 200); assert.equal(retry.status, 200);
    assert.notEqual(first.body.data.alreadyRestored, retry.body.data.alreadyRestored);
    assert.deepEqual(first.body.data.counts, { folders: 1, items: 2, trash: 1, versions: 1, attachments: 1 });
    assert.equal(await prisma.vaultItem.count({ where: { userId: target.data.user.id } }), 3);
    assert.deepEqual(await prisma.vaultItem.findUnique({ where: { id: existing.id } }), existing);
    const restored = await request(baseUrl, '/api/backups/snapshot', { headers: targetHeaders });
    const entries = restored.body.data.snapshot.items.filter(item => item.id !== existing.id);
    assert.equal(entries.filter(item => item.deletedAt).length, 1);
    for (const item of entries) {
      assert.equal(item.createdAt, date.toISOString());
      assert.equal(item.updatedAt, date.toISOString());
      assert.notEqual(item.folderId, folder.id);
      assert.deepEqual(await decryptJSON(item.encryptedData, item.iv, targetKey), payload);
      for (const version of item.versions) {
        assert.equal(version.folderId, null); // deleted historical folder
        assert.deepEqual(await decryptJSON(version.encryptedData, version.iv, targetKey), payload);
      }
      for (const file of item.attachments) {
        assert.deepEqual(new Uint8Array(await decryptBinary(file.encryptedBlob, file.blobIv, targetKey)), new Uint8Array([0, 1, 255]));
      }
    }
  } finally {
    if (source?.data?.user) await prisma.user.delete({ where: { id: source.data.user.id } });
    if (target?.data?.user) await prisma.user.delete({ where: { id: target.data.user.id } });
    await stopTestServer(server);
  }
});

test('invalid references and unexpected key fields are rejected; database failures roll back folders, items and receipt', async () => {
  const { server, baseUrl } = await startTestServer();
  const { prisma } = await import('../dist/config/prisma.js');
  const originalTransaction = prisma.$transaction.bind(prisma);
  let user;
  try {
    user = await registerUser(baseUrl);
    const headers = { authorization: `Bearer ${user.accessToken}` };
    const date = '2026-01-02T03:04:05.000Z';
    const folderId = randomUUID();
    const body = { backupId: randomUUID(), snapshot: {
      folders: [{ id: folderId, name: 'Rollback folder', createdAt: date, updatedAt: date }],
      items: [{ id: randomUUID(), folderId, encryptedData: 'ciphertext', iv: 'iv', favorite: false, deletedAt: null,
        createdAt: date, updatedAt: date, versions: [], attachments: [] }],
    } };
    assert.equal((await request(baseUrl, '/api/backups/restore', { method: 'POST', headers, body: { ...body, sourceKey: 'must-never-arrive' } })).status, 400);
    const invalid = structuredClone(body); invalid.snapshot.items[0].folderId = randomUUID();
    assert.equal((await request(baseUrl, '/api/backups/restore', { method: 'POST', headers, body: invalid })).status, 400);
    prisma.$transaction = (operation, options) => originalTransaction(async tx => {
      // Fail after data inserts, proving receipt creation and every insert share
      // the same transaction. This is only the disposable test database.
      const originalCreate = tx.backupRestore.create;
      tx.backupRestore.create = async () => { throw new Error('Injected test failure'); };
      try { return await operation(tx); }
      finally { tx.backupRestore.create = originalCreate; }
    }, options);
    assert.equal((await request(baseUrl, '/api/backups/restore', { method: 'POST', headers, body })).status, 500);
    prisma.$transaction = originalTransaction;
    assert.equal(await prisma.folder.count({ where: { userId: user.data.user.id } }), 0);
    assert.equal(await prisma.vaultItem.count({ where: { userId: user.data.user.id } }), 0);
    assert.equal(await prisma.backupRestore.count({ where: { userId: user.data.user.id } }), 0);
    assert.equal((await request(baseUrl, '/api/backups/restore', { method: 'POST', headers, body })).status, 200);
  } finally {
    prisma.$transaction = originalTransaction;
    if (user?.data?.user) await prisma.user.delete({ where: { id: user.data.user.id } });
    await stopTestServer(server);
  }
});

test('oversized snapshots and restore requests fail explicitly without partial backups or imports', async () => {
  const { server, baseUrl } = await startTestServer();
  const { prisma } = await import('../dist/config/prisma.js');
  let user;
  try {
    user = await registerUser(baseUrl);
    const headers = { authorization: `Bearer ${user.accessToken}` };
    await prisma.vaultItem.create({ data: { userId: user.data.user.id, encryptedData: 'x'.repeat(17 * 1024 * 1024), iv: 'iv' } });
    const oversized = await request(baseUrl, '/api/backups/snapshot', { headers });
    assert.equal(oversized.status, 413);
    assert.equal(oversized.body.success, false);
    const restore = await request(baseUrl, '/api/backups/restore', { method: 'POST', headers, body: { excessive: 'x'.repeat(17 * 1024 * 1024) } });
    assert.equal(restore.status, 413);
    assert.equal(await prisma.backupRestore.count({ where: { userId: user.data.user.id } }), 0);
    assert.equal(await prisma.vaultItem.count({ where: { userId: user.data.user.id } }), 1);
  } finally {
    if (user?.data?.user) await prisma.user.delete({ where: { id: user.data.user.id } });
    await stopTestServer(server);
  }
});
