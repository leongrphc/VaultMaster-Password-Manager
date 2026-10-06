import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { registerUser, request, startTestServer, stopTestServer } from './integration-helpers.mjs';
const date = '2026-10-06T00:00:00.000Z';
function body(state, target, folder) {
  const sourceId = randomUUID(), folderId = randomUUID();
  return { backupId: randomUUID(), snapshot: { folders: [{ id: folderId, name: 'Synthetic', createdAt: date, updatedAt: date }], items: [{ id: sourceId, folderId, encryptedData: 'ciphertext-new', iv: 'iv-new', favorite: true, deletedAt: null, createdAt: date, updatedAt: date, versions: [], attachments: [] }] },
    review: { state, folderMap: folder ? { [folderId]: folder } : {}, replacements: target ? { [sourceId]: target } : {}, overwriteApproved: !!target } };
}
test('reviewed imports require a current owned state and explicit overwrite approval; retries never duplicate', async () => {
  const { server, baseUrl } = await startTestServer();
  const { prisma } = await import('../dist/config/prisma.js');
  let user, foreign;
  try {
    user = await registerUser(baseUrl); foreign = await registerUser(baseUrl);
    const userId = user.data.user.id, headers = { authorization: `Bearer ${user.accessToken}` };
    const existing = await prisma.vaultItem.create({ data: { userId, encryptedData: 'ciphertext-before', iv: 'iv-before' } });
    const folder = await prisma.folder.create({ data: { userId, name: 'Synthetic' } });
    const other = await prisma.vaultItem.create({ data: { userId: foreign.data.user.id, encryptedData: 'foreign', iv: 'foreign' } });
    const state = async () => (await request(baseUrl, '/api/backups/import-state', { headers })).body.data.state;
    assert.equal((await request(baseUrl, '/api/backups/import-state')).status, 401);
    const input = body(await state(), existing.id, folder.id);
    const send = value => request(baseUrl, '/api/backups/restore', { method: 'POST', headers, body: value });
    assert.equal((await send({ ...input, review: { ...input.review, overwriteApproved: false } })).status, 409);
    const forged = structuredClone(input); forged.review.replacements[forged.snapshot.items[0].id] = other.id;
    assert.equal((await send(forged)).status, 409);
    const badFolder = structuredClone(input); badFolder.review.folderMap[badFolder.snapshot.folders[0].id] = randomUUID();
    assert.equal((await send(badFolder)).status, 409);
    assert.equal((await send(input)).status, 200);
    const retry = await send(input);
    assert.equal(retry.status, 200); assert.equal(retry.body.data.alreadyRestored, true);
    assert.ok(!JSON.stringify(retry.body).includes('importDigest'));
    assert.equal(await prisma.vaultItem.count({ where: { userId } }), 1);
    assert.equal(await prisma.folder.count({ where: { userId } }), 1);
    const updated = await prisma.vaultItem.findUnique({ where: { id: existing.id } });
    assert.equal(updated.encryptedData, 'ciphertext-new'); assert.equal(updated.folderId, folder.id);
    const history = await prisma.vaultItemVersion.findMany({ where: { vaultItemId: existing.id } });
    assert.equal(history.length, 1); assert.equal(history[0].encryptedData, 'ciphertext-before');
    const different = structuredClone(input); different.snapshot.items[0].encryptedData = 'other';
    assert.equal((await send(different)).status, 409);
    const stale = body(await state());
    await prisma.vaultItem.update({ where: { id: existing.id }, data: { favorite: false } });
    assert.equal((await send(stale)).status, 409);
    assert.equal(await prisma.backupRestore.count({ where: { userId } }), 1);
    assert.equal((await prisma.vaultItem.findUnique({ where: { id: other.id } })).encryptedData, 'foreign');
  } finally {
    for (const account of [user, foreign]) if (account?.data?.user) await prisma.user.delete({ where: { id: account.data.user.id } });
    await stopTestServer(server);
  }
});
test('replacement failure rolls back history, folders, ciphertext and receipt; retry commits once', async () => {
  const { server, baseUrl } = await startTestServer();
  const { prisma } = await import('../dist/config/prisma.js');
  const transaction = prisma.$transaction.bind(prisma);
  let user;
  try {
    user = await registerUser(baseUrl);
    const userId = user.data.user.id, headers = { authorization: `Bearer ${user.accessToken}` };
    const existing = await prisma.vaultItem.create({ data: { userId, encryptedData: 'unchanged', iv: 'iv' } });
    const state = (await request(baseUrl, '/api/backups/import-state', { headers })).body.data.state;
    const input = body(state, existing.id);
    prisma.$transaction = (operation, options) => transaction(async tx => {
      const create = tx.backupRestore.create.bind(tx.backupRestore);
      tx.backupRestore.create = async args => { await create(args); throw new Error('Synthetic transaction failure'); };
      return operation(tx);
    }, options);
    assert.equal((await request(baseUrl, '/api/backups/restore', { method: 'POST', headers, body: input })).status, 500);
    prisma.$transaction = transaction;
    assert.equal(await prisma.folder.count({ where: { userId } }), 0);
    assert.equal(await prisma.vaultItemVersion.count({ where: { vaultItemId: existing.id } }), 0);
    assert.equal(await prisma.backupRestore.count({ where: { userId } }), 0);
    assert.deepEqual(await prisma.vaultItem.findUnique({ where: { id: existing.id } }), existing);
    assert.equal((await request(baseUrl, '/api/backups/restore', { method: 'POST', headers, body: input })).status, 200);
  } finally {
    prisma.$transaction = transaction;
    if (user?.data?.user) await prisma.user.delete({ where: { id: user.data.user.id } });
    await stopTestServer(server);
  }
});

test('concurrent reviewed retries commit at most once and stale folder/trash reviews fail closed', async () => {
  const { server, baseUrl } = await startTestServer();
  const { prisma } = await import('../dist/config/prisma.js');
  let user;
  try {
    user = await registerUser(baseUrl);
    const userId = user.data.user.id, headers = { authorization: `Bearer ${user.accessToken}` };
    const state = async () => (await request(baseUrl, '/api/backups/import-state', { headers })).body.data.state;
    const input = body(await state());
    const send = value => request(baseUrl, '/api/backups/restore', { method: 'POST', headers, body: value });
    const results = await Promise.all([send(input), send(input)]);
    assert.equal(results.filter(result => result.status === 200 && !result.body.data.alreadyRestored).length, 1);
    assert.ok(results.every(result => [200, 409].includes(result.status)));
    assert.equal((await send(input)).body.data.alreadyRestored, true);
    assert.equal(await prisma.vaultItem.count({ where: { userId } }), 1);
    const staleFolder = body(await state());
    const folder = await prisma.folder.findFirst({ where: { userId } });
    await prisma.folder.update({ where: { id: folder.id }, data: { name: 'Changed' } });
    assert.equal((await send(staleFolder)).status, 409);
    const staleTrash = body(await state());
    const item = await prisma.vaultItem.findFirst({ where: { userId } });
    await prisma.vaultItem.update({ where: { id: item.id }, data: { deletedAt: new Date() } });
    assert.equal((await send(staleTrash)).status, 409);
    const noTrashOverwrite = body(await state(), item.id);
    assert.equal((await send(noTrashOverwrite)).status, 409);
    assert.equal(await prisma.backupRestore.count({ where: { userId } }), 1);
  } finally {
    if (user?.data?.user) await prisma.user.delete({ where: { id: user.data.user.id } });
    await stopTestServer(server);
  }
});
