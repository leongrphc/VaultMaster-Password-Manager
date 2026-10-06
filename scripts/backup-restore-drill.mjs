// Invoked by the isolated cluster harness, never against a supplied database.
import assert from 'node:assert/strict';
import { randomUUID, createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createStoredPasskey, signStoredPasskey, createVaultKey, exportMasterKeyBase64, encryptJSON, encryptBinary, decryptJSON, decryptBinary } from '../packages/crypto/dist/index.js';
import { build } from 'esbuild';

const work = process.env.VM_DRILL_WORK;
assert.match(work ?? '', /^\/tmp\/vm-drill\.[A-Za-z0-9]+$/);
assert.equal(process.env.DATABASE_URL, `postgresql://drill@localhost/drill_source?host=${work}/socket`);
assert.equal(process.env.DATABASE_DIRECT_URL, process.env.DATABASE_URL);
assert.equal(process.env.SENTRY_DSN, undefined);
await build({ entryPoints: [new URL('../apps/web/src/lib/full-backup.ts', import.meta.url).pathname, new URL('../apps/web/src/lib/backup-transfer.ts', import.meta.url).pathname], outdir: `${work}/client`, outExtension: { '.js': '.mjs' }, bundle: true, platform: 'node', format: 'esm' });
const { createFullBackup, openFullBackup, prepareBackupRestore } = await import(`${work}/client/full-backup.mjs`);
const { encodeBackupTransfer, decodeBackupTransfer } = await import(`${work}/client/backup-transfer.mjs`);
const { registerUser, authorizedRequest: request, startTestServer, stopTestServer } = await import('../apps/api/tests/integration-helpers.mjs');
const { prisma } = await import('../apps/api/dist/config/prisma.js');
const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const recoveredDb = new PrismaClient({ datasources: { db: { url: `postgresql://drill@localhost/drill_recovered?host=${work}/socket` } } });
const evidence = { formatVersion: 1, timestamp: new Date().toISOString(),
  revision: execFileSync('git', ['-C', new URL('..', import.meta.url).pathname, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  implementationSha256: { harness: createHash('sha256').update(await readFile(new URL('./backup-restore-drill.sh', import.meta.url))).digest('hex'), scenario: createHash('sha256').update(await readFile(new URL('./backup-restore-drill.mjs', import.meta.url))).digest('hex') },
  nodeVersion: process.version, postgresqlVersion: execFileSync(`${process.env.VM_DRILL_PGBIN}/pg_dump`, ['--version'], { encoding: 'utf8' }).trim(),
  scope: 'synthetic-only; local Unix socket; TCP disabled', status: 'incomplete', checks: {} };
const { server, baseUrl } = await startTestServer();
const originalTransaction = prisma.$transaction.bind(prisma);
let source, target;
const date = new Date('2026-01-02T03:04:05.000Z');
const counts = async userId => ({
  folders: await prisma.folder.count({ where: { userId } }),
  items: await prisma.vaultItem.count({ where: { userId } }),
  versions: await prisma.vaultItemVersion.count({ where: { vaultItem: { userId } } }),
  attachments: await prisma.attachment.count({ where: { userId } }),
  receipts: await prisma.backupRestore.count({ where: { userId } }),
});
const expected = { folders: 1, items: 2, trash: 1, versions: 1, attachments: 1 };
const api = async (path, options = {}, status = 200) => {
  const response = await request(baseUrl, path, options);
  assert.equal(response.status, status, `Unexpected HTTP status at ${path.replace(/[0-9a-f-]{36}/g, ':id')}`);
  return response.body?.data;
};
try {
  assert.equal(await prisma.user.count(), 0);
  source = await registerUser(baseUrl); target = await registerUser(baseUrl);
  assert.equal(source.response.status, 201); assert.equal(target.response.status, 201);
  const sourceKey = await createVaultKey(), targetKey = await createVaultKey();
  const sourceHeaders = { authorization: `Bearer ${source.accessToken}` };
  const targetHeaders = { authorization: `Bearer ${target.accessToken}` };
  // More than one HTTP/file chunk, plus every recoverable personal data type.
  const passkeyRequest = { origin: 'https://recovery.example.test', rpId: 'recovery.example.test', challenge: randomBytes(32).toString('base64url'),
    user: { id: Buffer.from('synthetic-recovery-user').toString('base64url'), name: 'Synthetic recovery' } };
  const generated = await createStoredPasskey(passkeyRequest, []);
  const { verifyRegistrationResponse, verifyAuthenticationResponse } = require('@simplewebauthn/server');
  const verified = await verifyRegistrationResponse({ response: generated.response, expectedChallenge: passkeyRequest.challenge,
    expectedOrigin: passkeyRequest.origin, expectedRPID: passkeyRequest.rpId, requireUserVerification: false });
  assert.equal(verified.verified, true);
  const verifyRecoveredPasskey = async stored => {
    const request = { ...passkeyRequest, user: undefined, challenge: randomBytes(32).toString('base64url'), allowCredentials: [generated.stored.credentialId] };
    const response = await signStoredPasskey(request, stored);
    assert.equal((await verifyAuthenticationResponse({ response, credential: verified.registrationInfo.credential, expectedChallenge: request.challenge,
      expectedOrigin: request.origin, expectedRPID: request.rpId, requireUserVerification: false })).verified, true);
  };
  const payload = { type: 'passkey', ...generated.stored, title: 'Synthetic drill', padding: 'x'.repeat(1024 * 1024) };
  const encrypted = await encryptJSON(payload, sourceKey);
  const metadata = { name: 'synthetic.bin', type: 'application/octet-stream' };
  const encryptedMetadata = await encryptJSON(metadata, sourceKey);
  const blob = await encryptBinary(new Uint8Array([0, 1, 255]).buffer, sourceKey);
  const folder = await prisma.folder.create({ data: { userId: source.data.user.id, name: 'Synthetic folder', createdAt: date, updatedAt: date } });
  const fields = { userId: source.data.user.id, folderId: folder.id, encryptedData: encrypted.ciphertext, iv: encrypted.iv, createdAt: date, updatedAt: date };
  const active = await prisma.vaultItem.create({ data: { ...fields, favorite: true } });
  await prisma.vaultItem.create({ data: { ...fields, deletedAt: date } });
  await prisma.vaultItemVersion.create({ data: { vaultItemId: active.id, encryptedData: encrypted.ciphertext, iv: encrypted.iv,
    folderId: folder.id, favorite: false, reason: 'update', createdAt: date } });
  await prisma.attachment.create({ data: { userId: source.data.user.id, vaultItemId: active.id,
    encryptedMetadata: encryptedMetadata.ciphertext, metadataIv: encryptedMetadata.iv,
    encryptedBlob: blob.ciphertext, blobIv: blob.iv, size: 3, createdAt: date, updatedAt: date } });
  const existingData = await encryptJSON({ title: 'Keep existing' }, targetKey);
  const existing = await prisma.vaultItem.create({ data: { userId: target.data.user.id, encryptedData: existingData.ciphertext, iv: existingData.iv } });
  const manifest = await api('/api/backups/snapshot?version=4', { headers: sourceHeaders });
  assert.ok(manifest.chunkCount > 1);
  const snapshot = await decodeBackupTransfer({ totalBytes: manifest.totalBytes, chunkCount: manifest.chunkCount }, async index => {
    const endpoint = `/api/backups/transfers/${manifest.transferId}/chunks/${index}`;
    await api(endpoint, { headers: targetHeaders }, 404);
    return api(endpoint, { headers: sourceHeaders });
  }, () => {});
  const password = randomUUID() + randomUUID(); // ephemeral; never recorded
  const file = await createFullBackup({ scope: 'personal-vault', ...snapshot,
    vaultKeyBase64: await exportMasterKeyBase64(sourceKey) }, password, () => {});
  await writeFile(`${work}/personal-backup.json`, file, { mode: 0o600 });
  await prisma.user.delete({ where: { id: source.data.user.id } }); source = null;
  const archive = await openFullBackup(await readFile(`${work}/personal-backup.json`, 'utf8'), password);
  assert.ok(JSON.parse(file).chunks.length > 1);
  const body = await prepareBackupRestore(archive, await exportMasterKeyBase64(targetKey), () => {});
  evidence.checks.personalBackup = { version: 4, exportChunks: manifest.chunkCount, fileChunks: JSON.parse(file).chunks.length, sourceDeletedBeforeRecovery: true };
  const encoded = encodeBackupTransfer(body);
  const transfer = await api('/api/backups/transfers', { method: 'POST', headers: targetHeaders, body: encoded.manifest });
  const endpoint = `/api/backups/transfers/${transfer.transferId}`;
  for (let index = 0; index < encoded.manifest.chunkCount; index++) {
    for (let retry = 0; retry < 2; retry++) await api(`${endpoint}/chunks`, { method: 'PUT', headers: targetHeaders, body: encoded.chunk(index) });
  }
  const before = await counts(target.data.user.id);
  assert.deepEqual(before, { folders: 0, items: 1, versions: 0, attachments: 0, receipts: 0 });
  let inserted;
  // Test-only interception: fail at the receipt, AFTER all data types were inserted.
  // No fault switch is added to the production API.
  prisma.$transaction = (operation, options) => originalTransaction(async tx => {
    tx.backupRestore.create = async () => {
      inserted = {
        folders: await tx.folder.count({ where: { userId: target.data.user.id } }),
        items: await tx.vaultItem.count({ where: { userId: target.data.user.id } }),
        versions: await tx.vaultItemVersion.count({ where: { vaultItem: { userId: target.data.user.id } } }),
        attachments: await tx.attachment.count({ where: { userId: target.data.user.id } }),
      };
      throw new Error('Synthetic drill receipt failure');
    };
    return operation(tx);
  }, options);
  await api(`${endpoint}/commit`, { method: 'POST', headers: targetHeaders }, 500);
  prisma.$transaction = originalTransaction;
  assert.deepEqual(inserted, { folders: 1, items: 3, versions: 1, attachments: 1 });
  const after = await counts(target.data.user.id);
  assert.deepEqual(after, before);
  assert.deepEqual(await prisma.vaultItem.findUnique({ where: { id: existing.id } }), existing);
  assert.equal(await prisma.backupTransferChunk.count({ where: { transferId: transfer.transferId } }), encoded.manifest.chunkCount);
  evidence.checks.rollback = { injectedAt: 'receipt creation after all inserts', httpStatus: 500, before, insideTransaction: inserted, after, stagedChunksRetained: true, existingItemUnchanged: true };
  const results = await Promise.all([1, 2].map(() => api(`${endpoint}/commit`, { method: 'POST', headers: targetHeaders })));
  assert.deepEqual(results.map(result => result.alreadyRestored).sort(), [false, true]);
  for (const result of results) assert.deepEqual(result.counts, expected);
  const retry = await api(`${endpoint}/commit`, { method: 'POST', headers: targetHeaders });
  assert.equal(retry.alreadyRestored, true);
  assert.deepEqual(await counts(target.data.user.id), { folders: 1, items: 3, versions: 1, attachments: 1, receipts: 1 });
  assert.deepEqual(await prisma.vaultItem.findUnique({ where: { id: existing.id } }), existing);
  const restored = await prisma.vaultItem.findMany({ where: { userId: target.data.user.id, id: { not: existing.id } }, include: { versions: true, attachments: true } });
  assert.equal(restored.filter(item => item.deletedAt).length, 1);
  for (const item of restored) {
    assert.equal(item.createdAt.toISOString(), date.toISOString());
    assert.equal(item.updatedAt.toISOString(), date.toISOString());
    assert.notEqual(item.folderId, folder.id);
    assert.deepEqual(await decryptJSON(item.encryptedData, item.iv, targetKey), payload);
    for (const version of item.versions) {
      assert.equal(version.folderId, item.folderId);
      assert.equal(version.createdAt.toISOString(), date.toISOString());
      assert.deepEqual(await decryptJSON(version.encryptedData, version.iv, targetKey), payload);
    }
    for (const attachment of item.attachments) {
      assert.deepEqual(await decryptJSON(attachment.encryptedMetadata, attachment.metadataIv, targetKey), metadata);
      assert.deepEqual(new Uint8Array(await decryptBinary(attachment.encryptedBlob, attachment.blobIv, targetKey)), new Uint8Array([0, 1, 255]));
    }
  }
  await api(endpoint, { method: 'DELETE', headers: targetHeaders });
  assert.equal(await prisma.backupTransfer.count(), 0);
  assert.equal(await prisma.backupTransferChunk.count(), 0);
  evidence.checks.restore = { counts: expected, uploadChunks: encoded.manifest.chunkCount, duplicateUploads: 'accepted', concurrentAndSequentialRetries: 'one receipt; no duplicates', destinationDecryption: 'all content types passed', existingItemUnchanged: true };

  // Exercise operational PostgreSQL backup and recovery, separate from personal export.
  const pg = (tool, args) => execFileSync(`${process.env.VM_DRILL_PGBIN}/${tool}`, args, { stdio: 'pipe' });
  pg('pg_dump', ['-h', `${work}/socket`, '-U', 'drill', '-d', 'drill_source', '-Fc', '-f', `${work}/server.dump`]);
  pg('pg_restore', ['-h', `${work}/socket`, '-U', 'drill', '-d', 'drill_recovered', '--exit-on-error', `${work}/server.dump`]);
  const tables = await prisma.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
  for (const { tablename } of tables) {
    assert.match(tablename, /^[a-z_]+$/);
    // Compare every persisted row (including migration history) without outputting it.
    const query = `SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]'::jsonb) AS rows FROM "${tablename}" t`;
    assert.deepEqual(await recoveredDb.$queryRawUnsafe(query), await prisma.$queryRawUnsafe(query));
  }
  await verifyRecoveredPasskey(await decryptJSON(restored[0].encryptedData, restored[0].iv, targetKey));
  const recoveredItem = await recoveredDb.vaultItem.findUniqueOrThrow({ where: { id: restored[0].id } });
  assert.deepEqual(await decryptJSON(recoveredItem.encryptedData, recoveredItem.iv, targetKey), payload);
  await verifyRecoveredPasskey(await decryptJSON(recoveredItem.encryptedData, recoveredItem.iv, targetKey));
  evidence.checks.vaultPasskeyRecovery = { personalFile: true, databaseDump: true, verifiedAssertions: 2 };
  evidence.checks.postgresqlRecovery = { format: 'pg_dump custom / pg_restore --exit-on-error', tablesCompared: tables.length, everyRowEqual: true, destinationDecryption: 'passed', dumpSha256: createHash('sha256').update(await readFile(`${work}/server.dump`)).digest('hex') };
  // The recovered database includes synthetic auth/session state; remove it too.
  await recoveredDb.user.deleteMany();
  await prisma.user.delete({ where: { id: target.data.user.id } }); target = null;
  for (const db of [prisma, recoveredDb]) {
    await db.abuseBucket.deleteMany(); // Synthetic rate budgets have no account FK.
    for (const { tablename } of tables.filter(table => table.tablename !== '_prisma_migrations')) {
      const [result] = await db.$queryRawUnsafe(`SELECT COUNT(*)::integer AS count FROM "${tablename}"`);
      assert.equal(result.count, 0);
    }
  }
  await writeFile(process.env.VM_DRILL_REPORT, JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
} finally {
  prisma.$transaction = originalTransaction;
  if (source?.data?.user) await prisma.user.delete({ where: { id: source.data.user.id } });
  if (target?.data?.user) await prisma.user.delete({ where: { id: target.data.user.id } });
  await stopTestServer(server);
  await prisma.$disconnect();
  await recoveredDb.$disconnect();
}
