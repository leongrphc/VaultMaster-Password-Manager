import test from 'node:test';
import assert from 'node:assert/strict';
import { proxyApi } from '../../workers/web.mjs';

test('same-origin proxy preserves cookie/CSRF headers and bodies without forwarding bearer credentials', async () => {
  let forwarded;
  const response = await proxyApi(new Request('https://vault.example/api/vault?x=1', {
    method: 'POST', headers: { cookie: 'fixture-cookie', origin: 'https://vault.example', authorization: 'Bearer must-not-forward', 'x-vaultmaster-client': 'web' }, body: '{"fixture":true}',
  }), { API_ORIGIN: 'https://api.example/' }, async request => {
    forwarded = request;
    return new Response('{"success":true}', { headers: { 'set-cookie': '__Host-session=fixture; Path=/; Secure; HttpOnly', 'access-control-allow-origin': '*' } });
  });
  assert.equal(forwarded.url, 'https://api.example/api/vault?x=1');
  assert.equal(await forwarded.text(), '{"fixture":true}');
  assert.equal(forwarded.headers.get('cookie'), 'fixture-cookie');
  assert.equal(forwarded.headers.get('origin'), 'https://vault.example');
  assert.equal(forwarded.headers.get('authorization'), null);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.ok(response.headers.get('set-cookie').includes('HttpOnly'));
});
test('proxy refuses redirects and unsafe upstream configuration', async () => {
  const request = new Request('https://vault.example/api/vault');
  assert.equal((await proxyApi(request, { API_ORIGIN: 'invalid' }, () => { throw new Error('must not fetch'); })).status, 503);
  assert.equal((await proxyApi(request, { API_ORIGIN: 'http://api.example' }, () => { throw new Error('must not fetch'); })).status, 503);
  assert.equal((await proxyApi(request, { API_ORIGIN: 'https://api.example' }, async () => new Response(null, { status: 302, headers: { location: 'https://evil.example' } }))).status, 502);
});
