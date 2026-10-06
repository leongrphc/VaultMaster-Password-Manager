import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../src/passkey-injected.js', import.meta.url), 'utf8');
function install(origin = 'https://example.test', secure = true, framed = false) {
  const calls = [];
  const credentials = Object.fromEntries(['create', 'get'].map(operation => [operation, function (options) {
    assert.equal(this, credentials);
    calls.push({ operation, options });
    return Promise.resolve('native');
  }]));
  const window = { isSecureContext: secure };
  window.top = framed ? {} : window;
  const navigator = { credentials };
  runInNewContext(source, { navigator, location: new URL(origin), window, Object, ArrayBuffer });
  return { navigator, credentials, calls, window };
}
const creation = { challenge: new Uint8Array(32), rp: { id: 'example.test' },
  user: { id: new Uint8Array([1]), name: 'Synthetic' }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }] };

test('unsupported passkey requirements retain native WebAuthn without requesting software approval', async () => {
  for (const publicKey of [
    { ...creation, authenticatorSelection: { userVerification: 'required' } },
    { ...creation, authenticatorSelection: { authenticatorAttachment: 'platform' } },
    { ...creation, attestation: 'direct' },
    { ...creation, pubKeyCredParams: [{ type: 'public-key', alg: -257 }] },
    { ...creation, extensions: { prf: {} } },
    { ...creation, rp: { id: 'test' } },
  ]) {
    const fixture = install(); const options = { publicKey };
    assert.equal(await fixture.navigator.credentials.create(options), 'native');
    assert.deepEqual(fixture.calls, [{ operation: 'create', options }]);
  }
  for (const options of [
    { publicKey: { challenge: creation.challenge, userVerification: 'required' } },
    { publicKey: { challenge: creation.challenge, extensions: { prf: {} } } },
    { publicKey: { challenge: creation.challenge }, mediation: 'conditional' },
    { publicKey: { challenge: creation.challenge }, mediation: 'silent' },
  ]) {
    const fixture = install();
    assert.equal(await fixture.navigator.credentials.get(options), 'native');
    assert.deepEqual(fixture.calls, [{ operation: 'get', options }]);
  }
  for (const fixture of [install('http://example.test', false), install('https://example.test', true, true)]) {
    const options = { publicKey: creation };
    assert.equal(await fixture.navigator.credentials.create(options), 'native');
    assert.deepEqual(fixture.calls, [{ operation: 'create', options }]);
  }
});

test('vault account MFA and local unlock keep the original native credential object', async () => {
  for (const origin of ['http://localhost:3000', 'http://127.0.0.1:3000']) {
    const fixture = install(origin);
    assert.equal(fixture.navigator.credentials, fixture.credentials);
    assert.equal(fixture.window.__vaultmasterPasskeyInjected, undefined);
    const options = { publicKey: { challenge: creation.challenge, extensions: { prf: {} } } };
    assert.equal(await fixture.navigator.credentials.get(options), 'native');
    assert.deepEqual(fixture.calls, [{ operation: 'get', options }]);
  }
});
