import test from 'node:test';
import assert from 'node:assert/strict';
import { VaultSession } from '../dist/vault-session.js';
import { deriveMasterKey, generateAuthHash, createVaultKey, wrapVaultKey, encryptJSON, decryptJSON, exportMasterKeyBase64 } from '../../../packages/crypto/dist/index.js';

const email = 'native@example.test', password = 'Native-master-password-2026!';
const wrappingKey = await deriveMasterKey(password, email);
const authHash = await generateAuthHash(wrappingKey, password);
const key = await createVaultKey();
const envelope = { ...await wrapVaultKey(key, wrappingKey), version: 1 };
const keyBase64 = await exportMasterKeyBase64(key);
const record = { type: 'login', title: 'Native fixture', username: 'octo', password: 'native-fixture-secret', url: 'https://example.test', totpSecret: 'JBSWY3DPEHPK3PXP', notes: 'private-note' };
const encrypted = await encryptJSON(record, key);
const encryptedItem = { id: 'item-1', encryptedData: encrypted.ciphertext, iv: encrypted.iv, folderId: null };
function area() {
  const values = new Map();
  return { values, level: null, async setAccessLevel({ accessLevel }) { this.level = accessLevel; },
    async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(name => [name, structuredClone(values.get(name))])); },
    async set(input) { for (const [name, value] of Object.entries(input)) values.set(name, structuredClone(value)); },
    async remove(keys) { for (const name of Array.isArray(keys) ? keys : [keys]) values.delete(name); } };
}
async function fixture() {
  const storage = { session: area(), local: area() };
  const state = { revoked: false, expired: false, refreshes: 0, twoFactor: false, legacy: false, items: [encryptedItem], gate: null };
  let time = 1000000;
  const fetcher = async (url, options) => {
    assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
    const path = new URL(url).pathname;
    const body = options.body ? JSON.parse(options.body) : null;
    assert.ok(!options.body?.includes(password));
    const reply = (data, status = 200) => new Response(JSON.stringify({ success: status < 400, data, error: status >= 400 ? 'fixture rejection' : undefined }), { status });
    if (path.endsWith('/auth/login')) {
      assert.equal(body.vaultKeyProtocol, 1);
      if (body.authHash !== authHash) return reply(null, 401);
      if (state.twoFactor && body.code !== '123456') return reply({ requires2FA: true });
      if (state.loginGate) await state.loginGate;
      return reply({ user: { id: 'user-1', email }, deviceId: 'device-1', tokens: { accessToken: 'access', refreshToken: 'refresh' }, vaultKeyEnvelope: state.legacy ? null : envelope });
    }
    if (path.endsWith('/auth/logout')) return reply({});
    if (path.endsWith('/auth/refresh')) {
      state.refreshes++;
      if (state.revoked) return reply(null, 401);
      await new Promise(done => setTimeout(done, 10)); state.expired = false;
      return reply({ tokens: { accessToken: 'next-access', refreshToken: 'next-refresh' } });
    }
    assert.ok(options.headers.Authorization?.startsWith('Bearer '));
    if (state.revoked || state.expired) return reply(null, 401);
    if (path.endsWith('/auth/unlock')) return body.authHash === authHash ? reply({ vaultKeyEnvelope: state.legacy ? null : envelope }) : reply(null, 403);
    if (path.endsWith('/auth/me')) { if (state.meGate) await state.meGate; return reply({ id: 'user-1', email }); }
    if (path.endsWith('/vault') && options.method === 'GET') { if (state.gate) await state.gate; return reply(state.items); }
    if (path.includes('/vault') && ['POST', 'PUT'].includes(options.method)) {
      state.saved = body; state.savedPath = path; if (state.persistSaved) state.items.push({ id: 'saved-item', ...body }); return reply({ id: 'saved-item' });
    }
    throw new Error(`Unexpected path ${path}`);
  };
  const session = new VaultSession({ storage, fetcher, apiUrl: 'https://api.example/api', now: () => time });
  await session.ready;
  return { session, storage, state, fetcher, setTime(value) { time = value; } };
}
const login = session => session.login({ email, password });
const credential = session => session.request('VM_GET_LOGIN_CREDENTIAL_REQUEST', { itemId: 'item-1', pageUrl: 'https://example.test/login' });

test('independent login unwraps the DEK, keeps secrets out of persistent storage, and returns only requested credential fields', async () => {
  const { session, storage } = await fixture(); await login(session);
  assert.equal(storage.session.level, 'TRUSTED_CONTEXTS');
  const local = JSON.stringify([...storage.local.values]);
  for (const value of [password, keyBase64, record.password, 'refresh', 'access']) assert.ok(!local.includes(value));
  const response = await credential(session);
  assert.equal(response.payload.credential.password, record.password);
  assert.equal(response.payload.credential.totpSecret, undefined);
  assert.equal(response.payload.credential.notes, undefined);
  assert.ok(!JSON.stringify((await session.request('VM_LIST_LOGIN_SUGGESTIONS_REQUEST', { pageUrl: 'https://example.test' })).payload).includes(record.password));
});
test('lock and the absolute deadline remove keys, decrypted items and pending fills', async () => {
  const { session, storage, setTime } = await fixture(); await login(session);
  await storage.session.set({ vaultmasterPendingAutofill: { id: 'pending' } });
  setTime(1300001);
  assert.equal((await session.status()).isLocked, true);
  assert.equal(session.key, null); assert.deepEqual(session.items, []);
  assert.equal(storage.session.values.get('vaultmasterNativeSession').keyBase64, null);
  assert.equal(storage.session.values.has('vaultmasterPendingAutofill'), false);
  assert.equal((await credential(session)).payload.status, 'locked');
});
test('worker restarts restore only a non-expired trusted memory session and recheck the API before a fill', async () => {
  const { session, storage, fetcher, state } = await fixture(); await login(session);
  const restarted = new VaultSession({ storage, fetcher, apiUrl: session.apiUrl, now: () => 1100000 });
  await restarted.ready;
  assert.equal((await credential(restarted)).payload.credential.password, record.password);
  state.revoked = true;
  await assert.rejects(credential(restarted));
  assert.equal((await restarted.status()).isAuthenticated, false);
  const expired = new VaultSession({ storage, fetcher, apiUrl: session.apiUrl, now: () => 1400000 });
  await expired.ready; assert.equal(expired.key, null);
});
test('wrong passwords do not unlock or destroy a valid device session, including empty legacy vaults', async () => {
  const { session, state } = await fixture(); await login(session); await session.lock();
  await assert.rejects(session.unlock('wrong-password'));
  assert.equal((await session.status()).isAuthenticated, true); assert.equal(session.key, null);
  await session.unlock(password); assert.equal((await session.status()).isLocked, false);
  state.legacy = true; state.items = [];
  await session.logout(); await login(session); await session.lock();
  await assert.rejects(session.unlock('wrong-password')); assert.equal(session.key, null);
});
test('simultaneous expired requests perform one refresh and preserve the correct device session', async () => {
  const { session, state } = await fixture(); await login(session); state.expired = true;
  await Promise.all([credential(session), credential(session)]);
  assert.equal(state.refreshes, 1); assert.equal(session.session.tokens.refreshToken, 'next-refresh');
});
test('late ciphertext sync cannot restore plaintext after lock', async () => {
  const { session, state } = await fixture(); await login(session);
  let release; state.gate = new Promise(done => { release = done; });
  const syncing = session.sync(); const rejected = assert.rejects(syncing, /kilitlendi/);
  await new Promise(done => setTimeout(done, 5)); await session.lock(); release(); await rejected;
  assert.equal(session.key, null); assert.deepEqual(session.items, []);
});
test('late login cannot resurrect a logged-out session', async () => {
  const { session, state } = await fixture();
  let release; state.loginGate = new Promise(done => { release = done; });
  const loggingIn = login(session); const rejected = assert.rejects(loggingIn, /iptal/);
  await new Promise(done => setTimeout(done, 250)); await session.logout(); release(); await rejected;
  assert.equal(session.session, null); assert.equal(session.key, null);
});
test('TOTP and credential retrieval reject unrelated hosts and HTTPS downgrades, including forced fills', async () => {
  const { session } = await fixture(); await login(session);
  for (const pageUrl of ['http://example.test', 'https://example.test.evil.test']) {
    assert.equal((await session.request('VM_GET_LOGIN_CREDENTIAL_REQUEST', { itemId: 'item-1', pageUrl, forceFill: pageUrl.startsWith('http:') })).payload.status, 'domain_mismatch');
    assert.equal((await session.request('VM_GET_TOTP_CODE_REQUEST', { itemId: 'item-1', pageUrl })).payload.totpCode, undefined);
  }
  assert.match((await session.request('VM_GET_TOTP_CODE_REQUEST', { itemId: 'item-1', pageUrl: 'https://example.test' })).payload.totpCode, /^\d{6}$/);
});
test('confirmed updates encrypt for the existing DEK and preserve unrelated fields', async () => {
  const { session, state } = await fixture(); await login(session);
  assert.equal((await session.request('VM_SAVE_LOGIN_REQUEST', { credential: { title: 'New title', url: record.url, username: record.username, password: 'updated-secret' } })).payload.status, 'updated');
  const saved = await decryptJSON(state.saved.encryptedData, state.saved.iv, key);
  assert.equal(saved.password, 'updated-secret'); assert.equal(saved.notes, record.notes); assert.equal(saved.totpSecret, record.totpSecret);
  assert.equal(state.savedPath, '/api/vault/item-1');
});
test('2FA challenge does not establish a session or retain a password', async () => {
  const { session, state, storage } = await fixture(); state.twoFactor = true;
  assert.equal((await login(session)).requires2FA, true); assert.equal(session.session, null);
  assert.equal(storage.session.values.has('vaultmasterNativeSession'), false);
  await session.login({ email, password, code: '123456' }); assert.ok(session.key);
});

test('save preview requires the same record and ciphertext at confirmation', async () => {
  const { session, state } = await fixture(); await login(session);
  const credential = { url: record.url, username: record.username, password: 'changed-password' };
  const preview = (await session.request('VM_PREVIEW_LOGIN_SAVE_REQUEST', { credential })).payload;
  assert.equal(preview.operation, 'update'); assert.equal(preview.itemId, 'item-1'); assert.equal(state.saved, undefined);
  const changed = await encryptJSON({ ...record, notes: 'edited elsewhere' }, key);
  state.items = [{ ...encryptedItem, encryptedData: changed.ciphertext, iv: changed.iv }];
  assert.equal((await session.request('VM_SAVE_LOGIN_REQUEST', { credential, expectedSave: preview })).payload.status, 'save_conflict');
  assert.equal(state.saved, undefined);
});

test('create preview cannot silently become an update and duplicate accounts are rejected', async () => {
  const { session, state } = await fixture(); await login(session);
  const credential = { url: record.url, username: 'new-user', password: 'new-password' };
  const preview = (await session.request('VM_PREVIEW_LOGIN_SAVE_REQUEST', { credential })).payload;
  assert.equal(preview.operation, 'create');
  const added = await encryptJSON({ ...record, username: credential.username }, key);
  state.items = [...state.items, { id: 'new-item', encryptedData: added.ciphertext, iv: added.iv }];
  assert.equal((await session.request('VM_SAVE_LOGIN_REQUEST', { credential, expectedSave: preview })).payload.status, 'save_conflict');
  state.items.push({ ...state.items[1], id: 'duplicate' });
  assert.equal((await session.request('VM_PREVIEW_LOGIN_SAVE_REQUEST', { credential })).payload.status, 'ambiguous_accounts');
  assert.equal((await session.request('VM_SAVE_LOGIN_REQUEST', { credential })).payload.status, 'ambiguous_accounts');
  assert.equal(state.saved, undefined);
});

test('sync logs successful, decrypt and transport outcomes without vault data or session identifiers', async () => {
  const lines = [], original = console.info;
  console.info = line => lines.push(line);
  try {
    const { session: vault, state } = await fixture();
    await vault.login({ email, password });
    await vault.sync();
    state.items = [{ ...encryptedItem, encryptedData: 'synthetic-invalid-ciphertext' }];
    await assert.rejects(() => vault.sync());
    const saved = vault.fetcher;
    vault.fetcher = async () => { throw new Error(password); };
    await assert.rejects(() => vault.sync()); vault.fetcher = saved;
    const events = lines.map(line => JSON.parse(line));
    assert.ok(events.some(event => event.outcome === 'success'));
    assert.ok(events.some(event => event.reason === 'decrypt'));
    assert.ok(events.some(event => event.reason === 'network'));
    const text = lines.join('');
    for (const secret of [email, password, record.password, encrypted.ciphertext, encryptedItem.id, keyBase64]) assert.ok(!text.includes(secret), 'secret boundary failed');
  } finally { console.info = original; }
});

test('passkeys require unlock/action guards, encrypted storage, re-sync, explicit item selection and exclusion handling', async () => {
  const { session, state } = await fixture();
  const request = { origin: 'https://example.test', rpId: 'example.test', challenge: btoa('synthetic-challenge-32-bytes-long'), user: { id: btoa('user-id').replace(/=+$/, ''), name: 'Synthetic' } };
  request.challenge = request.challenge.replace(/=+$/, '');
  await assert.rejects(session.performPasskey('create', request, null, () => {}));
  await login(session); state.persistSaved = true;
  let approvals = 0;
  const registered = await session.performPasskey('create', request, null, () => { ++approvals; });
  assert.ok(approvals > 1);
  const stored = await decryptJSON(state.saved.encryptedData, state.saved.iv, key);
  assert.equal(stored.type, 'passkey'); assert.ok(stored.privateKey.startsWith('vm-passkey-v1:'));
  assert.ok(!JSON.stringify(state.saved).includes(stored.privateKey));
  const get = { ...request, user: undefined, allowCredentials: [registered.id] };
  assert.deepEqual(await session.passkeyCandidates(get), [{ itemId: 'saved-item', title: 'example.test', username: 'Synthetic' }]);
  assert.equal((await session.performPasskey('get', get, 'saved-item', () => {})).id, registered.id);
  const conflicting = await encryptJSON({ ...stored, privateKey: stored.privateKey + ' ' }, key);
  state.items.push({ id: 'conflicting-copy', encryptedData: conflicting.ciphertext, iv: conflicting.iv });
  await assert.rejects(session.performPasskey('get', get, 'saved-item', () => {}));
  state.items.pop();

  await assert.rejects(session.performPasskey('create', { ...request, excludeCredentials: [registered.id] }, null, () => {}));
  await assert.rejects(session.performPasskey('get', get, 'unknown', () => {}));
  await assert.rejects(session.performPasskey('get', get, 'saved-item', () => { throw new Error('cancelled'); }));
  await session.lock();
  await assert.rejects(session.performPasskey('get', get, 'saved-item', () => {}));
  await session.unlock(password);
  assert.equal((await session.performPasskey('get', get, 'saved-item', () => {})).id, registered.id);
  state.revoked = true;
  await assert.rejects(session.performPasskey('get', get, 'saved-item', () => {}));
  assert.equal(session.key, null);
});
test('lock while passkey post-sign session check is pending suppresses assertion output', async () => {
  const { session, state } = await fixture(); await login(session); state.persistSaved = true;
  const request = { origin: 'https://example.test', rpId: 'example.test', challenge: Buffer.alloc(32, 8).toString('base64url'), user: { id: Buffer.from('user').toString('base64url'), name: 'Synthetic' } };
  await session.performPasskey('create', request, null, () => {});
  let release; state.meGate = new Promise(resolve => { release = resolve; });
  const operation = session.performPasskey('get', { ...request, user: undefined }, 'saved-item', () => {});
  await new Promise(resolve => setTimeout(resolve, 30)); await session.lock(); release();
  await assert.rejects(operation);
});
