import test from 'node:test';
import assert from 'node:assert/strict';
import { authHeaders, registerUser, request, cleanupIntegrationUsers, disconnectPrisma, startTestServer, stopTestServer } from './integration-helpers.mjs';
let server, baseUrl;
test.before(async () => { await cleanupIntegrationUsers(); ({ server, baseUrl } = await startTestServer()); });
test.after(async () => { await stopTestServer(server); await cleanupIntegrationUsers(); await disconnectPrisma(); });
test('legacy shared-vaults cannot enumerate recipients or release unauthenticated envelopes', async () => {
  const user = await registerUser(baseUrl);
  for (const [path, method] of [['', 'GET'], ['', 'POST'], ['/00000000-0000-4000-8000-000000000001/release', 'GET']]) {
    const response = await request(baseUrl, '/api/shared-vaults' + path, { method, headers: authHeaders(user.accessToken), ...(method === 'POST' ? { body: { contactEmail: 'synthetic@example.invalid' } } : {}) });
    assert.equal(response.status, 410); assert.equal(response.headers.get('cache-control'), 'no-store'); assert.ok(!JSON.stringify(response.body).includes('@'));
  }
});
