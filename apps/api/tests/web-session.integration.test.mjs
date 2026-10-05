import test from 'node:test';
import assert from 'node:assert/strict';
import { request, createRegisterPayload, startTestServer, stopTestServer } from './integration-helpers.mjs';
const web = { 'x-vaultmaster-client': 'web', origin: 'http://localhost:3000' };
function cookie(response) { return response.headers.getSetCookie().map(value => value.split(';')[0]).join('; '); }

test('web sessions expose no JWTs, rotate HttpOnly cookies and revoke logout with an expired access cookie', async () => {
  const { server, baseUrl } = await startTestServer();
  const { prisma } = await import('../dist/config/prisma.js');
  let userId;
  try {
    const payload = createRegisterPayload();
    const registered = await request(baseUrl, '/api/auth/register', { method: 'POST', headers: web, body: payload });
    assert.equal(registered.status, 201);
    userId = registered.body.data.user.id;
    assert.equal(registered.body.data.session, true);
    assert.equal(registered.body.data.tokens, undefined);
    const values = registered.headers.getSetCookie();
    assert.equal(values.length, 2);
    for (const value of values) {
      assert.match(value, /^__Host-vaultmaster-/);
      assert.match(value, /HttpOnly/); assert.match(value, /Secure/); assert.match(value, /SameSite=Strict/); assert.match(value, /Path=\//);
      assert.ok(!value.includes('Domain='));
    }
    const initial = cookie(registered);
    assert.equal((await request(baseUrl, '/api/auth/me', { headers: { ...web, cookie: initial } })).status, 200);
    const refreshed = await request(baseUrl, '/api/auth/refresh', { method: 'POST', headers: { ...web, cookie: initial }, body: {} });
    assert.equal(refreshed.status, 200);
    assert.equal(refreshed.body.data.session, true);
    assert.equal(refreshed.body.data.tokens, undefined);
    assert.notEqual(cookie(refreshed), initial);
    const current = cookie(refreshed);
    // A forged/expired access cookie must not prevent explicit logout via the
    // valid refresh session, and clearing cookies alone must not be the logout.
    const onlyRefresh = current.split('; ').filter(value => value.startsWith('__Host-vaultmaster-refresh=')).join('; ');
    const loggedOut = await request(baseUrl, '/api/auth/logout', { method: 'POST', headers: { ...web, cookie: onlyRefresh }, body: {} });
    assert.equal(loggedOut.status, 200);
    assert.equal(loggedOut.headers.getSetCookie().length, 2);
    assert.equal((await request(baseUrl, '/api/auth/me', { headers: { ...web, cookie: current } })).status, 401);
    assert.equal((await request(baseUrl, '/api/auth/refresh', { method: 'POST', headers: { ...web, cookie: current }, body: {} })).status, 401);
  } finally {
    if (userId) await prisma.user.delete({ where: { id: userId } });
    await stopTestServer(server);
  }
});

test('cookie mutations reject missing/untrusted/null origins, missing headers and cross-site fetches', async () => {
  const { server, baseUrl } = await startTestServer();
  const { prisma } = await import('../dist/config/prisma.js');
  let userId;
  try {
    const payload = createRegisterPayload();
    const registered = await request(baseUrl, '/api/auth/register', { method: 'POST', headers: web, body: payload });
    userId = registered.body.data.user.id;
    const cookies = cookie(registered);
    const variants = [
      { 'x-vaultmaster-client': 'web' }, { ...web, origin: 'https://evil.example' },
      { ...web, origin: 'null' }, { origin: web.origin }, { ...web, 'sec-fetch-site': 'cross-site' },
    ];
    for (const headers of variants) {
      const response = await request(baseUrl, '/api/vault', { method: 'POST', headers: { ...headers, cookie: cookies }, body: { encryptedData: 'unwanted', iv: 'iv' } });
      assert.equal(response.status, 403);
    }
    assert.equal(await prisma.vaultItem.count({ where: { userId } }), 0);
    const login = await request(baseUrl, '/api/auth/login', { method: 'POST', headers: web, body: { email: payload.email, authHash: payload.authHash, vaultKeyProtocol: 1 } });
    assert.equal(login.status, 200);
    assert.equal(login.body.data.tokens, undefined);
    assert.equal(login.body.data.session, true);
  } finally {
    if (userId) await prisma.user.delete({ where: { id: userId } });
    await stopTestServer(server);
  }
});
