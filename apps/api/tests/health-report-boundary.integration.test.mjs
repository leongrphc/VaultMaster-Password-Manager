import test from 'node:test';
import assert from 'node:assert/strict';
import { registerUser, authorizedRequest as request, startTestServer, stopTestServer } from './integration-helpers.mjs';

test('health routes are service probes; cancelling staged transfers is owned, idempotent and preserves vault ciphertext', async () => {
  const { server, baseUrl } = await startTestServer();
  const { prisma } = await import('../dist/config/prisma.js');
  let owner, other;
  try {
    owner = await registerUser(baseUrl); other = await registerUser(baseUrl);
    const headers = { authorization: `Bearer ${owner.accessToken}` };
    const foreignHeaders = { authorization: `Bearer ${other.accessToken}` };
    const before = await prisma.vaultItem.create({ data: { userId: owner.data.user.id, encryptedData: 'opaque-fixture', iv: 'fixture-iv' } });
    for (const path of ['/api/health', '/api/health/ready']) {
      const probe = await request(baseUrl, path, { headers });
      assert.equal(probe.status, 200);
      assert.equal(probe.body.service, 'api');
      assert.equal(probe.body.status, 'ok');
      const text = JSON.stringify(probe.body);
      for (const secret of [owner.data.user.id, owner.payload.email, owner.payload.authHash, before.encryptedData, before.iv]) assert.ok(!text.includes(secret));
      assert.equal(probe.body.completed, undefined);
      assert.equal(probe.body.results, undefined);
    }
    // No report job endpoints or server receipt are implied by the client-only report.
    assert.equal((await fetch(`${baseUrl}/api/health/report`, { headers })).status, 404);
    const created = await request(baseUrl, '/api/backups/transfers', { method: 'POST', headers, body: { totalBytes: 1, chunkCount: 1 } });
    assert.equal(created.status, 200);
    const id = created.body.data.transferId;
    const path = `/api/backups/transfers/${id}`;
    assert.equal((await request(baseUrl, `${path}/chunks`, { method: 'PUT', headers, body: { index: 0, data: 'eA==' } })).status, 200);
    const denied = await request(baseUrl, path, { method: 'DELETE' });
    assert.equal(denied.status, 401);
    const foreign = await request(baseUrl, path, { method: 'DELETE', headers: foreignHeaders });
    const unknown = await request(baseUrl, '/api/backups/transfers/not-a-transfer', { method: 'DELETE', headers: foreignHeaders });
    assert.deepEqual(foreign.body, unknown.body);
    assert.equal(await prisma.backupTransfer.count({ where: { id } }), 1);
    const cancelled = await Promise.all([1, 2].map(() => request(baseUrl, path, { method: 'DELETE', headers })));
    for (const result of cancelled) { assert.equal(result.status, 200); assert.deepEqual(result.body, { success: true }); }
    assert.equal((await request(baseUrl, path, { method: 'DELETE', headers })).status, 200);
    assert.equal(await prisma.backupTransferChunk.count({ where: { transferId: id } }), 0);
    assert.equal((await request(baseUrl, `${path}/commit`, { method: 'POST', headers })).status, 404);
    assert.deepEqual(await prisma.vaultItem.findUnique({ where: { id: before.id } }), before);
    assert.equal(await prisma.backupRestore.count({ where: { userId: owner.data.user.id } }), 0);
  } finally {
    for (const user of [owner, other]) if (user?.data?.user) await prisma.user.delete({ where: { id: user.data.user.id } });
    await stopTestServer(server);
  }
});
