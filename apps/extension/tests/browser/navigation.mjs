import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createHash, generateKeyPairSync, randomBytes, verify } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { deriveMasterKey, generateAuthHash, createVaultKey, wrapVaultKey, encryptJSON, decryptJSON, exportMasterKeyBase64 } from '../../../../packages/crypto/dist/index.js';

test('real independent extension logs in, fills, locks, restarts and saves without any web vault tab', { timeout: 90000 }, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'vaultmaster-browser-'));
  const extension = join(temp, 'extension');
  const email = 'native-browser@example.test', password = 'Native-browser-master-password-2026!';
  const passwordKey = await deriveMasterKey(password, email);
  const authHash = await generateAuthHash(passwordKey, password);
  const key = await createVaultKey(), rawKey = await exportMasterKeyBase64(key);
  const vaultKeyEnvelope = { ...await wrapVaultKey(key, passwordKey), version: 1 };
  const credential = { type: 'login', title: 'Fixture', username: 'octo', password: 'fixture-secret', url: 'https://example.test' };
  const ciphertext = await encryptJSON(credential, key);
  let items = [{ id: 'fixture-login', encryptedData: ciphertext.ciphertext, iv: ciphertext.iv, folderId: null }];
  let revoked = false, failSave = false, reads = 0;
  const saved = [];
  const authenticatorKeys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const credentialId = randomBytes(32);
  const challenge = randomBytes(32).toString('base64url');
  let extensionOrigin;
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    assert.ok(!body.includes(password));
    const input = body ? JSON.parse(body) : {};
    const path = new URL(req.url, 'http://localhost').pathname;
    const reply = (data, status = 200) => { res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify({ success: status < 400, data, error: status >= 400 ? 'Fixture request rejected' : undefined })); };
    if (path.endsWith('/auth/login')) {
      if (input.authHash !== authHash) return reply(null, 401);
      if (!input.webAuthnResponse) return reply({ requires2FA: true, webAuthnOptions: { challengeToken: 'fixture-challenge-token', options: {
        challenge, rpId: 'vaultmaster.mozkan.com.tr', allowCredentials: [{ type: 'public-key', id: credentialId.toString('base64url') }], userVerification: 'preferred', timeout: 60000 } } });
      const assertion = input.webAuthnResponse.response;
      const client = Buffer.from(assertion.clientDataJSON, 'base64url');
      assert.equal(JSON.parse(client).origin, extensionOrigin); assert.equal(JSON.parse(client).challenge, challenge);
      assert.equal(verify('sha256', Buffer.concat([Buffer.from(assertion.authenticatorData, 'base64url'), createHash('sha256').update(client).digest()]), authenticatorKeys.publicKey, Buffer.from(assertion.signature, 'base64url')), true);
      return reply({ user: { id: 'user-1', email }, tokens: { accessToken: 'fixture-access', refreshToken: 'fixture-refresh' }, deviceId: 'device-1', vaultKeyEnvelope });
    }
    if (revoked) return reply(null, 401);
    if (path.endsWith('/auth/unlock')) return input.authHash === authHash ? reply({ vaultKeyEnvelope }) : reply(null, 403);
    if (path.endsWith('/auth/me')) return reply({ id: 'user-1', email });
    if (path.endsWith('/auth/logout')) { revoked = true; return reply({}); }
    if (path.endsWith('/vault') && req.method === 'GET') { reads++; return reply(items); }
    if (path.endsWith('/vault') && req.method === 'POST') {
      if (failSave) return reply(null, 503);
      assert.ok(!body.includes('new-login-secret'));
      saved.push(await decryptJSON(input.encryptedData, input.iv, key));
      return reply({ id: 'saved-item' });
    }
    return reply(null, 404);
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  let context;
  try {
    await cp(resolve('apps/extension/dist'), extension, { recursive: true });
    const backgroundPath = join(extension, 'background.js');
    await writeFile(backgroundPath, (await readFile(backgroundPath, 'utf8')) + '\nglobalThis.__vaultFixture = nativeVault;\n');
    const apiOrigin = `http://127.0.0.1:${server.address().port}`;
    await writeFile(join(extension, 'config.js'), `export const API_URL = ${JSON.stringify(apiOrigin + '/api')};`);
    const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
    manifest.content_security_policy.extension_pages = `script-src 'self'; object-src 'none'; connect-src ${apiOrigin}`;
    await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
    context = await chromium.launchPersistentContext(join(temp, 'profile'), { channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    context.setDefaultTimeout(10000);
    let worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).hostname;
    extensionOrigin = `chrome-extension://${extensionId}`;
    const popup = await context.newPage();
    const pageErrors = []; popup.on('pageerror', error => pageErrors.push(error.message));
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    const authenticatorCdp = await context.newCDPSession(popup);
    await authenticatorCdp.send('WebAuthn.enable');
    const { authenticatorId } = await authenticatorCdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    await authenticatorCdp.send('WebAuthn.addCredential', { authenticatorId, credential: { credentialId: credentialId.toString('base64'),
      rpId: 'vaultmaster.mozkan.com.tr', privateKey: authenticatorKeys.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'), isResidentCredential: true, userHandle: Buffer.from('user-1').toString('base64'), signCount: 0 } });
    await popup.getByLabel('E-posta').fill(email);
    await popup.getByLabel('Ana şifre', { exact: true }).fill(password);
    await popup.getByRole('button', { name: 'Giriş Yap', exact: true }).click();
    await expect(popup.getByRole('button', { name: 'Güvenlik Anahtarıyla Doğrula' })).toBeVisible();
    await popup.getByLabel('Ana şifre', { exact: true }).fill(password);
    await popup.getByRole('button', { name: 'Güvenlik Anahtarıyla Doğrula' }).click();
    try { await expect(popup.locator('#vault-status')).toHaveText('Vault açık ✓'); }
    catch (error) {
      const probe = await worker.evaluate(async origin => { try { const response = await fetch(origin + '/api/auth/me'); return response.status; } catch (failure) { return failure.message; } }, apiOrigin);
      throw new Error(`${await popup.locator('#status').innerText()} | ${JSON.stringify(pageErrors)} | ${probe}`, { cause: error });
    }
    assert.equal(await popup.locator('#master-password').inputValue(), '');
    assert.ok(!context.pages().some(page => page.url().startsWith('http://localhost:3000')));
    await context.route(/https:\/\/(example|evil)\.test\//, route => {
      const step = new URL(route.request().url()).pathname;
      if (step === '/success') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><p>Signed in</p>' });
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><form action="/success" method="post">
        ${step !== '/password' ? '<input id="email" autocomplete="username" type="email">' : ''}
        ${step !== '/identifier' ? '<input id="password" autocomplete="current-password" type="password">' : ''}
        <button id="submit" type="submit">Sign in</button></form>` });
    });
    const target = await context.newPage();
    async function fill() { return worker.evaluate(async () => { const tabs = await chrome.tabs.query({ url: 'https://example.test/*' });
      return chrome.tabs.sendMessage(tabs[0].id, { type: 'FILL_LOGIN_CREDENTIAL', itemId: 'fixture-login' }); }); }
    async function unlock() {
      await popup.bringToFront(); await popup.reload();
      await popup.getByLabel('Ana şifre', { exact: true }).fill(password);
      await popup.getByRole('button', { name: 'Kilidi Aç', exact: true }).click();
      await expect(popup.locator('#vault-status')).toHaveText('Vault açık ✓');
    }
    await target.goto('https://example.test/login'); await target.locator('#email').focus();
    await expect(target.locator('[data-action="fill"]')).toBeVisible();
    const beforeSynthetic = reads;
    await target.locator('[data-action="fill"]').evaluate(button => button.click());
    assert.equal(reads, beforeSynthetic); await expect(target.locator('#password')).toHaveValue('');
    await target.locator('[data-action="fill"]').click(); await expect(target.locator('#password')).toHaveValue(credential.password);
    await target.locator('#password').fill('');
    await popup.getByRole('button', { name: 'Kilitle', exact: true }).click();
    await expect(popup.locator('#vault-status')).toHaveText('Vault kilitli 🔒');
    assert.equal((await fill()).ok, false); await expect(target.locator('#password')).toHaveValue('');
    await popup.getByLabel('Ana şifre', { exact: true }).fill('wrong-password');
    await popup.getByRole('button', { name: 'Kilidi Aç', exact: true }).click();
    await expect(popup.locator('#status')).toContainText('Fixture request rejected');
    await expect(popup.locator('#vault-status')).toHaveText('Vault kilitli 🔒'); await unlock();
    await target.goto('https://example.test/login'); await target.locator('#email').focus();
    await expect(target.locator('[data-action="fill"]')).toBeVisible();
    // Exercise the warning UI with a deterministic domain-rejection fixture.
    // Native URL/scheme checks are separately tested against actual ciphertext.
    await worker.evaluate(async () => {
      const nativeVault = globalThis.__vaultFixture;
      const original = nativeVault.request.bind(nativeVault);
      globalThis.__originalRequest = original;
      nativeVault.request = (type, payload) => type === 'VM_GET_LOGIN_CREDENTIAL_REQUEST' && !payload.forceFill
        ? Promise.resolve({ ok: true, payload: { status: 'domain_mismatch' } }) : original(type, payload);
    });
    await target.locator('[data-action="fill"]').click(); await expect(target.locator('[data-action="force-fill"]')).toBeVisible();
    await target.locator('[data-action="force-fill"]').evaluate(button => button.click()); await expect(target.locator('#password')).toHaveValue('');
    await target.locator('[data-action="force-fill"]').click(); await expect(target.locator('#password')).toHaveValue(credential.password);
    await worker.evaluate(async () => {
      globalThis.__vaultFixture.request = globalThis.__originalRequest;
    });
    await target.goto('https://example.test/identifier'); assert.equal((await fill()).ok, true);
    await expect(target.locator('#email')).toHaveValue(credential.username);
    const pending = await worker.evaluate(async () => (await chrome.storage.session.get('vaultmasterPendingAutofill')).vaultmasterPendingAutofill);
    assert.ok(!JSON.stringify(pending).includes(credential.password));
    await target.goto('https://example.test/password'); await expect(target.locator('#password')).toHaveValue(credential.password);
    const cdp = await context.newCDPSession(popup);
    const { targetInfos } = await cdp.send('Target.getTargets');
    const workerTarget = targetInfos.find(info => info.type === 'service_worker' && info.url.includes(extensionId));
    assert.ok(workerTarget); await cdp.send('Target.closeTarget', { targetId: workerTarget.targetId });
    await popup.reload(); await expect(popup.locator('#vault-status')).toHaveText('Vault açık ✓');
    worker = context.serviceWorkers().find(candidate => candidate.url().includes(extensionId)) || await context.waitForEvent('serviceworker');
    await target.goto('https://example.test/login'); assert.equal((await fill()).ok, true);
    await expect(target.locator('#password')).toHaveValue(credential.password);
    const persistent = await worker.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null)));
    for (const value of [rawKey, password, credential.password, 'fixture-refresh', 'fixture-access']) assert.ok(!persistent.includes(value));
    await target.locator('#email').fill('new-user@example.test'); await target.locator('#password').fill('new-login-secret');
    await target.evaluate(() => document.querySelector('form').addEventListener('submit', () => { document.querySelector('#password').value = 'changed-after-submit'; }));
    await target.locator('#submit').click(); await target.waitForURL('https://example.test/success');
    await expect(target.locator('[data-action="save"]')).toBeVisible(); assert.equal(saved.length, 0);
    const drafts = await worker.evaluate(async () => (await chrome.storage.session.get('vaultmasterPendingSaves')).vaultmasterPendingSaves);
    assert.ok(!JSON.stringify(drafts).includes('new-login-secret'));
    await target.locator('[data-action="save"]').evaluate(button => button.click()); assert.equal(saved.length, 0);
    failSave = true; await target.locator('[data-action="save"]').click(); await expect(target.locator('[data-save-error]')).toBeVisible();
    failSave = false; await target.locator('[data-action="save"]').click(); await expect.poll(() => saved.length).toBe(1);
    assert.equal(saved[0].password, 'new-login-secret');
    await popup.getByRole('button', { name: 'Çıkış Yap', exact: true }).click();
    await expect(popup.locator('#vault-status')).toHaveText('Giriş yapılmadı');
    assert.equal(await worker.evaluate(async () => (await chrome.storage.session.get('vaultmasterNativeSession')).vaultmasterNativeSession), undefined);
    assert.deepEqual(pageErrors, []);
  } finally {
    await context?.close(); await new Promise(done => server.close(done));
    await rm(temp, { recursive: true, force: true });
  }
});
