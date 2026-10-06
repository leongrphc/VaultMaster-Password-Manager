import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createHash, generateKeyPairSync, randomBytes, verify } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { deriveMasterKey, generateAuthHash, createVaultKey, wrapVaultKey, encryptJSON, decryptJSON, exportMasterKeyBase64 } from '../../../../packages/crypto/dist/index.js';

test('real independent extension logs in, fills, locks, restarts and saves without any web vault tab', { timeout: 120000 }, async (t) => {
  const temp = await mkdtemp(join(tmpdir(), 'vaultmaster-browser-'));
  const extension = join(temp, 'extension');
  const email = 'native-browser@example.test', password = 'Native-browser-master-password-2026!';
  const passwordKey = await deriveMasterKey(password, email);
  const authHash = await generateAuthHash(passwordKey, password);
  const key = await createVaultKey(), rawKey = await exportMasterKeyBase64(key);
  const vaultKeyEnvelope = { ...await wrapVaultKey(key, passwordKey), version: 1 };
  const credential = { type: 'login', title: 'Fixture', username: 'octo', password: 'fixture-secret', url: 'https://example.test' };
  const ciphertext = await encryptJSON(credential, key);
  const httpCiphertext = await encryptJSON({ ...credential, title: 'HTTP Fixture', url: 'http://example.test' }, key);
  let items = [{ id: 'http-login', encryptedData: httpCiphertext.ciphertext, iv: httpCiphertext.iv, folderId: null }, { id: 'fixture-login', encryptedData: ciphertext.ciphertext, iv: ciphertext.iv, folderId: null }];
  for (const data of [
    { type: 'credit_card', title: 'Card Fixture', cardholderName: 'Synthetic User', cardNumber: '4111111111111111', expMonth: '12', expYear: '2030', cvv: '123' },
    { type: 'identity', title: 'Identity Fixture', fullName: 'Synthetic User', email: 'fixture@example.test', phone: '5550100' },
  ]) {
    const encrypted = await encryptJSON(data, key);
    items.push({ id: data.type, encryptedData: encrypted.ciphertext, iv: encrypted.iv, folderId: null });
  }
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
    if (path.endsWith('/vault/fixture-login') && req.method === 'PUT') {
      if (failSave) return reply(null, 503);
      const data = await decryptJSON(input.encryptedData, input.iv, key);
      saved.push(data);
      items = items.map(item => item.id === 'fixture-login' ? { ...item, encryptedData: input.encryptedData, iv: input.iv } : item);
      return reply({ id: 'fixture-login' });
    }
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
    await context.route(/https?:\/\/(example|evil|example.test.evil)\.test\//, route => {
      const step = new URL(route.request().url()).pathname;
      const form = '<form><input id="email" type="email" autocomplete="username"><input id="password" type="password" autocomplete="current-password"></form>';
      if (['/change', '/change-no-user', '/change-shadow', '/change-frame', '/change-foreign', '/ambiguous', '/new-password', '/many-new'].includes(step)) {
        const fields = step === '/ambiguous' ? '<input id="current" type="password"><input id="next" type="password">' :
          `${step !== '/new-password' ? '<input id="current" type="password" autocomplete="current-password">' : ''}<input id="next" type="password" autocomplete="new-password"><input id="confirm" type="password" autocomplete="new-password">${step === '/many-new' ? '<input id="repeat" type="password" autocomplete="new-password">' : ''}`;
        const change = `<form action="/success" method="post">${step !== '/change-no-user' ? '<input id="email" type="text" autocomplete="username" value="octo">' : ''}${fields}<button id="submit">Change password</button></form>`;
        if (step === '/change-frame' || step === '/change-foreign') return route.fulfill({ contentType: 'text/html', body: `<iframe src="https://${step === '/change-frame' ? 'example' : 'evil'}.test/change"></iframe>` });
        if (step === '/change-shadow') return route.fulfill({ contentType: 'text/html', body: `<div id="host"></div><script>document.querySelector('#host').attachShadow({mode:'open'}).innerHTML=${JSON.stringify(change)}</script>` });
        return route.fulfill({ contentType: 'text/html', body: change });
      }
      if (step === '/card') return route.fulfill({ contentType: 'text/html', body: '<form><input id="card" autocomplete="cc-number"><input id="holder" autocomplete="cc-name"></form>' });
      if (step === '/identity') return route.fulfill({ contentType: 'text/html', body: '<form><input id="full-name" name="full-name"><input id="phone" type="tel" autocomplete="tel"></form>' });
      if (step === '/nested-foreign') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><iframe src="https://evil.test/same-frame"></iframe>' });
      if (step === '/opaque') return route.fulfill({ contentType: 'text/html', body: `<iframe sandbox="allow-scripts" srcdoc='${form}'></iframe>` });
      if (step === '/same-frame'  || step === '/cross-frame') return route.fulfill({ contentType: 'text/html',
        body: `<!doctype html><iframe src="https://${step === '/same-frame' ? 'example' : 'evil'}.test/login"></iframe>` });
      if (step === '/open-shadow' || step === '/closed-shadow') return route.fulfill({ contentType: 'text/html', body:
        `<!doctype html><div id="host"></div><script>const root = document.querySelector('#host').attachShadow({mode:'${step === '/open-shadow' ? 'open' : 'closed'}'}); root.innerHTML = ${JSON.stringify(form)}; window.closedFixture = root;</script>` });
      if (step === '/success') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><p>Signed in</p>' });
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><form action="/success" method="post">
        ${step !== '/password' ? '<input id="email" autocomplete="username" type="email">' : ''}
        ${step !== '/identifier' ? '<input id="password" autocomplete="current-password" type="password">' : ''}
        <button id="submit" type="submit">Sign in</button></form>` });
    });
    const target = await context.newPage();
    async function fill() { return worker.evaluate(async () => { const tabs = await chrome.tabs.query({ url: 'https://example.test/*' });
      return chrome.tabs.sendMessage(tabs[0].id, { type: 'FILL_LOGIN_CREDENTIAL', itemId: 'fixture-login', formToken: (await chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_PAGE_AUTOFILL_STATE' }, { frameId: 0 })).payload.formToken }, { frameId: 0 }); }); }
    async function unlock() {
      await popup.bringToFront(); await target.bringToFront(); await popup.reload();
      await popup.getByLabel('Ana şifre', { exact: true }).fill(password);
      await popup.getByRole('button', { name: 'Kilidi Aç', exact: true }).click();
      await expect(popup.locator('#vault-status')).toHaveText('Vault açık ✓');
    }
    await target.goto('https://example.test/login'); await target.locator('#email').focus(); await target.bringToFront(); await popup.reload();
    await expect(popup.locator('[data-item-id="fixture-login"]')).toBeVisible();
    const beforeSynthetic = reads;
    await popup.locator('[data-item-id="fixture-login"]').evaluate(button => button.click());
    assert.equal(reads, beforeSynthetic); await expect(target.locator('#password')).toHaveValue('');
    await popup.locator('[data-item-id="fixture-login"]').click(); await expect(target.locator('#password')).toHaveValue(credential.password);
    await t.test('change forms fill current only and generate matching new passwords after a trusted popup click', async () => {
      await target.goto('https://example.test/change'); await target.locator('#current').focus(); await target.bringToFront(); await popup.reload();
      await expect(popup.locator('#items')).toContainText('Mevcut şifre');
      await popup.locator('[data-item-id="fixture-login"]').click();
      await expect(target.locator('#current')).toHaveValue(credential.password);
      await expect(target.locator('#next')).toHaveValue(''); await expect(target.locator('#confirm')).toHaveValue('');
      await popup.locator('[data-action="generate-password"]').evaluate(button => button.click());
      await expect(target.locator('#next')).toHaveValue('');
      await popup.locator('[data-action="generate-password"]').click();
      const generated = await target.locator('#next').inputValue();
      assert.match(generated, /^[A-Za-z0-9_-]{24}$/); assert.notEqual(generated, credential.password);
      await expect(target.locator('#confirm')).toHaveValue(generated);
      await popup.locator('[data-action="generate-password"]').click();
      await expect(target.locator('#next')).toHaveValue(generated); // No silent overwrite.
      await target.locator('#submit').click(); await target.waitForURL('https://example.test/success');
      await expect(target.locator('[data-action="save"]')).toHaveText('Şifreyi Güncelle'); assert.equal(saved.length, 0);
      await target.locator('[data-action="save"]').evaluate(button => button.click()); assert.equal(saved.length, 0);
      await target.locator('[data-action="save"]').click(); await expect.poll(() => saved.length).toBe(1);
      assert.equal(saved[0].password, generated); assert.equal(saved[0].username, 'octo');
      items = items.map(item => item.id === 'fixture-login' ? { ...item, encryptedData: ciphertext.ciphertext, iv: ciphertext.iv } : item); saved.length = 0;
    });
    await t.test('change without username uses the explicitly selected current account', async () => {
      await target.goto('https://example.test/change-no-user'); await target.bringToFront(); await popup.reload();
      await popup.locator('[data-item-id="fixture-login"]').click();
      await target.locator('#next').fill('manual-new-password'); await target.locator('#confirm').fill('manual-new-password');
      await target.locator('#submit').click(); await target.waitForURL('https://example.test/success');
      await expect(target.locator('[data-action="save"]')).toHaveText('Şifreyi Güncelle');
      await target.locator('[data-action="dismiss"]').click(); assert.equal(saved.length, 0);
    });
    await t.test('SPA submit snapshots survive a success route without saving automatically', async () => {
      await target.goto('https://example.test/change'); await target.bringToFront(); await popup.reload();
      await popup.locator('[data-item-id="fixture-login"]').click();
      await target.locator('#next').fill('spa-new-password'); await target.locator('#confirm').fill('spa-new-password');
      await target.evaluate(() => document.querySelector('form').addEventListener('submit', event => {
        event.preventDefault(); history.pushState({}, '', '/spa-success'); document.querySelector('form').remove();
      }));
      await target.locator('#submit').click(); await target.waitForURL('https://example.test/spa-success');
      await expect(target.locator('[data-action="save"]')).toHaveText('Şifreyi Güncelle'); assert.equal(saved.length, 0);
      await target.locator('[data-action="dismiss"]').click();
    });
    await t.test('an edited vault record cannot be silently overwritten after update approval', async () => {
      await target.goto('https://example.test/change'); await target.bringToFront(); await popup.reload();
      await popup.locator('[data-item-id="fixture-login"]').click();
      await target.locator('#next').fill('new-password'); await target.locator('#confirm').fill('new-password');
      await target.locator('#submit').click(); await target.waitForURL('https://example.test/success');
      await expect(target.locator('[data-action="save"]')).toHaveText('Şifreyi Güncelle');
      const changed = await encryptJSON({ ...credential, notes: 'concurrent edit' }, key);
      items = items.map(item => item.id === 'fixture-login' ? { ...item, encryptedData: changed.ciphertext, iv: changed.iv } : item);
      await target.locator('[data-action="save"]').click(); await expect(target.locator('[data-save-error]')).toContainText('üzerine yazılmadı');
      assert.equal(saved.length, 0); await target.locator('[data-action="dismiss"]').click();
      items = items.map(item => item.id === 'fixture-login' ? { ...item, encryptedData: ciphertext.ciphertext, iv: ciphertext.iv } : item);
    });
    await t.test('script submit, requestSubmit, and mismatched confirmations cannot capture credentials', async () => {
      await target.goto('https://example.test/change');
      await target.evaluate(() => { const form = document.querySelector('form'); form.addEventListener('submit', event => event.preventDefault());
        document.querySelector('#next').value = 'script-secret'; document.querySelector('#confirm').value = 'script-secret';
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); form.requestSubmit(); });
      await expect.poll(() => worker.evaluate(async () => Object.keys((await chrome.storage.session.get('vaultmasterPendingSaves')).vaultmasterPendingSaves || {}).length)).toBe(0);
      await target.locator('#next').fill('new-password'); await target.locator('#confirm').fill('different-password');
      await target.locator('#submit').click();
      assert.equal(await target.locator('[data-action="save"]').count(), 0);
      assert.equal(saved.length, 0);
    });
    await t.test('multiple unlabeled passwords are ambiguous and never filled or generated', async () => {
      await target.goto('https://example.test/ambiguous'); await target.bringToFront(); await popup.reload();
      await expect(popup.locator('#items')).toContainText('belirsiz');
      assert.equal(await popup.locator('[data-item-id="fixture-login"]').count(), 0);
      assert.equal(await popup.locator('[data-action="generate-password"]').count(), 0);
      assert.equal((await fill()).ok, false); await expect(target.locator('#current')).toHaveValue('');
    });
    await t.test('new-only and multiple confirmation fields receive generated passwords but never saved passwords', async () => {
      for (const path of ['new-password', 'many-new']) {
        await target.goto(`https://example.test/${path}`); await target.bringToFront(); await popup.reload();
        if (path === 'new-password') {
          await popup.locator('[data-item-id="fixture-login"]').click(); await expect(target.locator('#next')).toHaveValue('');
          assert.deepEqual(await worker.evaluate(async () => (await chrome.storage.session.get('vaultmasterPendingAutofill')).vaultmasterPendingAutofill || {}), {});
        }
        await popup.locator('[data-action="generate-password"]').click();
        const generated = await target.locator('#next').inputValue(); assert.equal(generated.length, 24);
        await expect(target.locator('#confirm')).toHaveValue(generated);
        if (path === 'many-new') await expect(target.locator('#repeat')).toHaveValue(generated);
      }
    });
    await t.test('SPA pushState, replaceState, hash and back navigation invalidate approvals on unchanged forms', async () => {
      await target.goto('https://example.test/change'); await target.bringToFront(); await popup.reload();
      await expect(popup.locator('[data-action="generate-password"]')).toBeVisible();
      await target.evaluate(() => history.pushState({}, '', '/spa-password'));
      await popup.locator('[data-action="generate-password"]').click(); await expect(target.locator('#next')).toHaveValue('');
      await expect(popup.locator('#status')).toContainText('yeniden');
      await target.bringToFront(); await popup.reload();
      await expect(popup.locator('[data-item-id="fixture-login"]')).toBeVisible();
      await target.evaluate(() => history.replaceState({}, '', '/spa-replaced'));
      await popup.locator('[data-item-id="fixture-login"]').click(); await expect(target.locator('#current')).toHaveValue('');
      await target.bringToFront(); await popup.reload();
      await expect(popup.locator('[data-action="generate-password"]')).toBeVisible();
      await target.evaluate(() => location.hash = 'password');
      await popup.locator('[data-action="generate-password"]').click(); await expect(target.locator('#next')).toHaveValue('');
      await target.goBack(); await target.bringToFront(); await popup.reload();
      await popup.locator('[data-item-id="fixture-login"]').click(); await expect(target.locator('#current')).toHaveValue(credential.password);
    });
    await t.test('change generation preserves same-origin iframe and open-root boundaries', async () => {
      for (const path of ['change-frame', 'change-shadow']) {
        await target.goto(`https://example.test/${path}`);
        const scope = path === 'change-frame' ? target.frameLocator('iframe') : target;
        await scope.locator('#current').focus(); await target.bringToFront(); await popup.reload();
        await popup.locator('[data-item-id="fixture-login"]').click(); await expect(scope.locator('#current')).toHaveValue(credential.password);
        await popup.locator('[data-action="generate-password"]').click();
        assert.equal((await scope.locator('#next').inputValue()).length, 24);
        await expect(scope.locator('#confirm')).toHaveValue(await scope.locator('#next').inputValue());
        if (path === 'change-shadow') {
        await scope.locator('#submit').click(); await target.waitForURL('https://example.test/success');
        await expect(target.locator('[data-action="save"]')).toHaveText('Şifreyi Güncelle');
        await target.locator('[data-action="dismiss"]').click(); assert.equal(saved.length, 0);
        }
      }
      await target.goto('https://example.test/change-foreign'); await target.bringToFront(); await popup.reload();
      assert.equal(await popup.locator('[data-action="generate-password"]').count(), 0);
      await expect(target.frameLocator('iframe').locator('#next')).toHaveValue('');
      await target.goto('https://example.test.evil.test/change'); await target.bringToFront(); await popup.reload();
      assert.equal(await popup.locator('[data-item-id="fixture-login"]').count(), 0);
      await expect(target.locator('#current')).toHaveValue('');
    });
    await target.goto('https://example.test/login'); await target.bringToFront(); await popup.reload();
    // Real Chromium frame and Shadow DOM checks with the production extension UI.
    await t.test('same-origin iframe fills only its selected document', async () => {
      await target.goto('https://example.test/same-frame'); await target.bringToFront(); await popup.reload();
      await expect(popup.locator('[data-item-id="fixture-login"]')).toBeVisible();
      await popup.locator('[data-item-id="fixture-login"]').click();
      await expect(target.frameLocator('iframe').locator('#password')).toHaveValue(credential.password);
    });
    await t.test('cross-origin iframe denies even a forced credential request', async () => {
      await target.goto('https://example.test/cross-frame'); await target.bringToFront(); await popup.reload();
      await expect(popup.locator('#items')).toContainText('Desteklenmiyor');
      assert.equal(await popup.locator('[data-item-id="fixture-login"]').count(), 0);
      await expect(target.frameLocator('iframe').locator('#password')).toHaveValue('');
      // A privileged test message cannot bypass the background's cross-origin policy.
      const deniedFrame = await worker.evaluate(async () => {
        const [tab] = await chrome.tabs.query({ url: 'https://example.test/cross-frame' });
        const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
        const child = frames.find(frame => frame.frameId !== 0);
        const state = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_AUTOFILL_STATE' }, { documentId: child.documentId });
        return chrome.tabs.sendMessage(tab.id, { type: 'FILL_LOGIN_CREDENTIAL', itemId: 'fixture-login',
          formToken: state.payload.formToken, forceFill: true }, { documentId: child.documentId });
      });
      assert.equal(deniedFrame.ok, false);
    });
    await t.test('foreign ancestors and opaque iframe documents are unsupported', async () => {
      for (const path of ['nested-foreign', 'opaque']) {
        await target.goto(`https://example.test/${path}`); await target.bringToFront(); await popup.reload();
        await expect(popup.locator('#items')).toContainText('Desteklenmiyor');
        assert.equal(await popup.locator('[data-item-id="fixture-login"]').count(), 0);
        for (const frame of target.frames().slice(1)) {
          if (await frame.locator('#password').count()) await expect(frame.locator('#password')).toHaveValue('');
        }
      }
    });
    await t.test('open Shadow DOM fills through protected extension selection', async () => {
      await target.goto('https://example.test/open-shadow'); await target.locator('#email').click(); await target.bringToFront(); await popup.reload();
      await expect(popup.locator('[data-item-id="fixture-login"]')).toBeVisible();
      // Page-created account selectors cannot read or retarget the popup selection.
      await target.evaluate(() => { const fake = document.createElement('button'); fake.dataset.itemId = 'attacker';
        fake.textContent = 'VaultMaster'; document.body.appendChild(fake); fake.click(); });
      await expect(target.locator('#password')).toHaveValue('');
      await popup.locator('[data-item-id="fixture-login"]').click();
      await expect(target.locator('#password')).toHaveValue(credential.password);
    });
    await t.test('closed Shadow DOM is unsupported without interception', async () => {
      await target.goto('https://example.test/closed-shadow'); await target.bringToFront(); await popup.reload();
      assert.equal(await fill().then(result => result.ok), false);
      assert.equal(await target.evaluate(() => window.closedFixture.querySelector('#password').value), '');
    });
    await t.test('page-script launcher clicks cannot select a credential', async () => {
      // Even a real click on the page launcher opens selection only; it never fills.
      await target.goto('https://example.test/login');
      await expect(target.locator('#vaultmaster-autofill-launcher')).toBeVisible();
      await target.locator('#vaultmaster-autofill-launcher').evaluate(button => {
        button.dataset.itemId = 'fixture-login'; button.click();
      });
      await expect(target.locator('#password')).toHaveValue('');
      await target.locator('#vaultmaster-autofill-launcher').click();
      await expect(target.locator('#password')).toHaveValue('');
    });
    await t.test('HTTP supports HTTP records and rejects forced HTTPS downgrade', async () => {
      await target.goto('http://example.test/login'); await target.bringToFront(); await popup.reload();
      assert.equal(await popup.locator('[data-item-id="fixture-login"]').count(), 0);
      const insecure = await worker.evaluate(async () => {
        const [tab] = await chrome.tabs.query({ url: 'http://example.test/*' });
        const state = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_AUTOFILL_STATE' }, { frameId: 0 });
        return chrome.tabs.sendMessage(tab.id, { type: 'FILL_LOGIN_CREDENTIAL', itemId: 'fixture-login',
          formToken: state.payload.formToken, forceFill: true }, { frameId: 0 });
      });
      assert.equal(insecure.status, 'domain_mismatch'); await expect(target.locator('#password')).toHaveValue('');
      await expect(popup.locator('[data-item-id="http-login"]')).toBeVisible();
      await popup.locator('[data-item-id="http-login"]').click();
      await expect(target.locator('#password')).toHaveValue(credential.password);
    });
    await t.test('phishing and deceptive hostnames receive no suggestions', async () => {
      await target.goto('https://evil.test/login'); await target.bringToFront(); await popup.reload();
      assert.equal(await popup.locator('[data-item-id="fixture-login"]').count(), 0);
      await target.goto('https://example.test/login'); await target.bringToFront(); await popup.reload();
      await target.goto('https://example.test.evil.test/login'); await target.bringToFront(); await popup.reload();
      assert.equal(await popup.locator('[data-item-id="fixture-login"]').count(), 0);
      await expect(target.locator('#password')).toHaveValue('');
      await target.goto('https://example.test/login'); await target.bringToFront(); await popup.reload();
    });
    await t.test('Chrome sender origin rejects a forged origin from the content world', async () => {
      const contexts = [];
      const sourceCdp = await context.newCDPSession(target);
      sourceCdp.on('Runtime.executionContextCreated', ({ context: execution }) => contexts.push(execution));
      await sourceCdp.send('Runtime.enable');
      const isolated = contexts.find(execution => execution.origin === extensionOrigin || execution.name === extensionOrigin);
      assert.ok(isolated, 'actual extension isolated world exists');
      const forged = await sourceCdp.send('Runtime.evaluate', { contextId: isolated.id, awaitPromise: true, returnByValue: true,
        expression: `chrome.runtime.sendMessage({type:'GET_LOGIN_CREDENTIAL',itemId:'fixture-login',pageUrl:'https://evil.test',forceFill:true})` });
      assert.equal(forged.result.value.ok, false);
      const forgedCapture = await sourceCdp.send('Runtime.evaluate', { contextId: isolated.id, awaitPromise: true, returnByValue: true,
        expression: `chrome.runtime.sendMessage({type:'CAPTURE_LOGIN',credential:{url:'https://evil.test',username:'octo',password:'phishing-secret'}})` });
      assert.equal(forgedCapture.result.value.ok, false);
      const forgedGenerate = await sourceCdp.send('Runtime.evaluate', { contextId: isolated.id, awaitPromise: true, returnByValue: true,
        expression: `chrome.runtime.sendMessage({type:'GENERATE_AUTOFILL_PASSWORD',tabId:42,documentId:'main',formToken:'forged'})` });
      assert.equal(forgedGenerate.result.value.ok, false);
      const verifiedPath = await sourceCdp.send('Runtime.evaluate', { contextId: isolated.id, awaitPromise: true, returnByValue: true,
        expression: `chrome.runtime.sendMessage({type:'LIST_LOGIN_SUGGESTIONS',pageUrl:'https://example.test/claimed-path',identifier:''})` });
      assert.equal(verifiedPath.result.value.ok, true);
      await expect(target.locator('#password')).toHaveValue('');
    });
    await t.test('stale form and document selections fail closed', async () => {
      // A popup selection becomes invalid after frame navigation or form replacement.
      await target.locator('form').evaluate(form => form.outerHTML = form.outerHTML);
      await popup.locator('[data-item-id="fixture-login"]').click();
      await expect(popup.locator('#status')).toContainText('formu değişti');
      await expect(target.locator('#password')).toHaveValue('');
      await target.goto('https://example.test/login'); await target.bringToFront(); await popup.reload();
      const stale = await popup.evaluate(async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const response = await chrome.runtime.sendMessage({ type: 'LIST_AUTOFILL_TARGETS', tabId: tab.id });
        return { tabId: tab.id, ...response.payload.targets.find(target => target.frameId === 0) };
      });
      await target.reload();
      const staleResult = await popup.evaluate(target => chrome.runtime.sendMessage({ type: 'FILL_AUTOFILL_TARGET',
        tabId: target.tabId, documentId: target.documentId, formToken: target.formToken, itemId: 'fixture-login' }), stale);
      assert.equal(staleResult.ok, false);
      assert.match(staleResult.message, /Hedef belge değişti/);
      await expect(target.locator('#password')).toHaveValue('');
      await target.bringToFront(); await popup.reload();
      await target.locator('#password').fill('');
    });
    await t.test('existing card and identity autofill also uses protected selection', async () => {
      for (const [path, itemId, field, value] of [
        ['card', 'credit_card', '#card', '4111111111111111'], ['identity', 'identity', '#full-name', 'Synthetic User'],
      ]) {
        await target.goto(`https://example.test/${path}`); await target.bringToFront(); await popup.reload();
        await expect(popup.locator(`[data-item-id="${itemId}"]`)).toBeVisible();
        assert.equal(await target.locator('[data-action="fill-structured"]').count(), 0);
        await popup.locator(`[data-item-id="${itemId}"]`).evaluate(button => button.click());
        await expect(target.locator(field)).toHaveValue('');
        await popup.locator(`[data-item-id="${itemId}"]`).click();
        await expect(target.locator(field)).toHaveValue(value);
      }
      await target.goto('https://example.test/login'); await target.bringToFront(); await popup.reload();
    });
    await popup.getByRole('button', { name: 'Kilitle', exact: true }).click();
    await expect(popup.locator('#vault-status')).toHaveText('Vault kilitli 🔒');
    assert.equal((await fill()).ok, false); await expect(target.locator('#password')).toHaveValue('');
    await popup.getByLabel('Ana şifre', { exact: true }).fill('wrong-password');
    await popup.getByRole('button', { name: 'Kilidi Aç', exact: true }).click();
    await expect(popup.locator('#status')).toContainText('Fixture request rejected');
    await expect(popup.locator('#vault-status')).toHaveText('Vault kilitli 🔒'); await unlock();
    await target.goto('https://example.test/login'); await target.locator('#email').focus(); await target.bringToFront(); await popup.reload();
    await expect(popup.locator('[data-item-id="fixture-login"]')).toBeVisible();
    // Exercise the warning UI with a deterministic domain-rejection fixture.
    // Native URL/scheme checks are separately tested against actual ciphertext.
    await worker.evaluate(async () => {
      const nativeVault = globalThis.__vaultFixture;
      const original = nativeVault.request.bind(nativeVault);
      globalThis.__originalRequest = original;
      nativeVault.request = (type, payload) => type === 'VM_GET_LOGIN_CREDENTIAL_REQUEST' && !payload.forceFill
        ? Promise.resolve({ ok: true, payload: { status: 'domain_mismatch' } }) : original(type, payload);
    });
    await popup.locator('[data-item-id="fixture-login"]').click(); await expect(popup.locator('[data-action="force-fill"]')).toBeVisible();
    await popup.locator('[data-action="force-fill"]').evaluate(button => button.click()); await expect(target.locator('#password')).toHaveValue('');
    await popup.locator('[data-action="force-fill"]').click(); await expect(target.locator('#password')).toHaveValue(credential.password);
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
    await target.bringToFront(); await popup.reload(); await expect(popup.locator('#vault-status')).toHaveText('Vault açık ✓');
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
