import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { deriveMasterKey, generateAuthHash, createVaultKey, wrapVaultKey, decryptJSON } from '../../../../packages/crypto/dist/index.js';
import { generateRegistrationOptions, generateAuthenticationOptions, verifyRegistrationResponse, verifyAuthenticationResponse } from '../../../api/node_modules/@simplewebauthn/server/esm/index.js';

test('Chromium vault passkey registration, assertion, protected approval, cancel, replay, scope, session and encrypted recovery', { timeout: 120000 }, async t => {
  const temp = await mkdtemp(join(tmpdir(), 'vm-passkey-browser-'));
  const extension = join(temp, 'extension');
  const email = 'passkey-browser@example.test', password = 'Synthetic-passkey-password-2026!';
  const wrapping = await deriveMasterKey(password, email), authHash = await generateAuthHash(wrapping, password);
  const key = await createVaultKey(), envelope = { ...await wrapVaultKey(key, wrapping), version: 1 };
  let items = [], revoked = false;
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    assert.ok(!body.includes(password));
    const input = body ? JSON.parse(body) : {};
    const reply = (data, status = 200) => { res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify({ success: status < 400, data, error: status >= 400 ? 'Synthetic rejection' : undefined })); };
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path.endsWith('/auth/login')) return input.authHash === authHash ? reply({ user: { id: 'synthetic-account', email }, deviceId: 'device', tokens: { accessToken: 'access', refreshToken: 'refresh' }, vaultKeyEnvelope: envelope }) : reply(null, 401);
    if (revoked) return reply(null, 401);
    if (path.endsWith('/auth/unlock')) return input.authHash === authHash ? reply({ vaultKeyEnvelope: envelope }) : reply(null, 403);
    if (path.endsWith('/auth/me')) return reply({ id: 'synthetic-account', email });
    if (path.endsWith('/vault') && req.method === 'GET') return reply(items);
    if (path.endsWith('/vault') && req.method === 'POST') {
      assert.deepEqual(Object.keys(input).sort(), ['encryptedData', 'folderId', 'iv']);
      const item = { id: crypto.randomUUID(), ...input }; items.push(item); return reply(item, 201);
    }
    return reply(null, 404);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const apiOrigin = `http://127.0.0.1:${server.address().port}`;
  let context;
  try {
    await cp(resolve('apps/extension/dist'), extension, { recursive: true });
    await writeFile(join(extension, 'config.js'), `export const API_URL = ${JSON.stringify(apiOrigin + '/api')};\n`);
    const manifest = JSON.parse(await readFile(join(extension, 'manifest.json')));
    manifest.content_security_policy.extension_pages = `script-src 'self'; object-src 'none'; connect-src ${apiOrigin}; base-uri 'none'; frame-src 'none'`;
    await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
    context = await chromium.launchPersistentContext(join(temp, 'profile'), { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    context.setDefaultTimeout(10000);
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).hostname;
    const popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.getByLabel('E-posta').fill(email); await popup.getByLabel('Ana şifre', { exact: true }).fill(password);
    await popup.getByRole('button', { name: 'Giriş Yap', exact: true }).click();
    await expect(popup.locator('#vault-status')).toHaveText('Kasa Kilidi Açık ✓');
    await context.route('https://passkey.example.test/**', route => route.fulfill({ contentType: 'text/html', headers: { 'content-security-policy': "default-src 'self'; script-src 'self'; object-src 'none'" }, body: '<!doctype html><title>Synthetic RP</title><h1>Passkey fixture</h1>' }));
    const page = await context.newPage(); await page.goto('https://passkey.example.test/');
    const rpID = 'passkey.example.test', origin = 'https://passkey.example.test';
    const options = await generateRegistrationOptions({ rpName: 'Synthetic', rpID, userName: 'synthetic-rp-account', userID: new TextEncoder().encode('rp-user'), supportedAlgorithmIDs: [-7], attestationType: 'none', authenticatorSelection: { userVerification: 'preferred', residentKey: 'required' } });
    async function start(operation, options) {
      await page.evaluate(({ operation, options }) => {
        const decode = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
        const publicKey = { ...options, challenge: decode(options.challenge) };
        if (publicKey.user) publicKey.user = { ...publicKey.user, id: decode(publicKey.user.id) };
        for (const name of ['allowCredentials', 'excludeCredentials']) if (publicKey[name]) publicKey[name] = publicKey[name].map(entry => ({ ...entry, id: decode(entry.id) }));
        window.abort = new AbortController(); window.result = null; window.error = null;
        navigator.credentials[operation]({ publicKey, signal: window.abort.signal }).then(value => { window.result = value.toJSON(); window.nativeShape = value instanceof PublicKeyCredential && value.response instanceof (operation === 'create' ? AuthenticatorAttestationResponse : AuthenticatorAssertionResponse); }).catch(error => { window.error = error.name; });
      }, { operation, options });
      await expect(page.locator('#vaultmaster-passkey-pending')).toBeVisible();
    }
    async function reloadPopup() { await page.bringToFront(); await popup.reload(); }
    await start('create', options);
    // A page cannot approve by forging a runtime-shaped postMessage.
    await page.evaluate(() => window.postMessage({ source: 'vaultmaster-passkey-injected', type: 'PASSKEY_APPROVE' }, location.origin));
    assert.equal(await page.evaluate(() => window.result), null);
    await reloadPopup();
    await popup.locator('[data-action="approve-passkey"]').evaluate(button => button.click());
    assert.equal(await page.evaluate(() => window.result), null);
    await popup.locator('[data-action="approve-passkey"]').click();
    await expect.poll(() => page.evaluate(() => Boolean(window.result))).toBe(true);
    const response = await page.evaluate(() => window.result);
    assert.equal(await page.evaluate(() => window.nativeShape), true);
    const verification = await verifyRegistrationResponse({ response, expectedChallenge: options.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false });
    assert.equal(verification.verified, true);
    const credential = verification.registrationInfo.credential;
    const recovered = await decryptJSON(items[0].encryptedData, items[0].iv, key);
    assert.ok(recovered.privateKey.startsWith('vm-passkey-v1:'));
    assert.ok(!JSON.stringify(items).includes(recovered.privateKey));
    t.diagnostic('registration and ciphertext-only persistence passed under strict page CSP');
    const getOptions = await generateAuthenticationOptions({ rpID, allowCredentials: [{ id: credential.id }], userVerification: 'preferred' });
    await start('get', getOptions); await reloadPopup(); await popup.locator('[data-action="approve-passkey"]').click();
    await expect.poll(() => page.evaluate(() => Boolean(window.result))).toBe(true);
    const signed = await page.evaluate(() => window.result);
    const verifyOptions = { response: signed, expectedChallenge: getOptions.challenge, expectedOrigin: origin, expectedRPID: rpID, credential, requireUserVerification: false };
    assert.equal((await verifyAuthenticationResponse(verifyOptions)).verified, true);
    // The relying party consumes challenges, including before failed verification.
    const used = new Set();
    async function consume(options) { if (used.has(options.expectedChallenge)) return false; used.add(options.expectedChallenge); return (await verifyAuthenticationResponse(options)).verified; }
    assert.equal(await consume(verifyOptions), true); assert.equal(await consume(verifyOptions), false);
    await assert.rejects(verifyAuthenticationResponse({ ...verifyOptions, expectedOrigin: 'https://evil.test' }));
    await assert.rejects(verifyAuthenticationResponse({ ...verifyOptions, expectedRPID: 'evil.test' }));
    await assert.rejects(verifyAuthenticationResponse({ ...verifyOptions, requireUserVerification: true }));
    t.diagnostic('assertion signature, challenge replay and server origin/RP/UV rejection passed');
    await start('get', getOptions); await reloadPopup(); await popup.locator('[data-action="cancel-passkey"]').click();
    await expect.poll(() => page.evaluate(() => window.error)).toBe('NotAllowedError');
    await start('get', getOptions); await page.evaluate(() => window.abort.abort());
    await expect.poll(() => page.evaluate(() => window.error)).toBe('AbortError');
    await start('get', getOptions); await reloadPopup(); await popup.getByRole('button', { name: 'Kasayı Kilitle' }).click();
    await expect.poll(() => page.evaluate(() => window.error)).toBe('NotAllowedError');
    await popup.getByLabel('Ana şifre', { exact: true }).fill(password); await popup.getByRole('button', { name: 'Kasanın Kilidini Aç', exact: true }).click();
    await expect(popup.locator('#vault-status')).toHaveText('Kasa Kilidi Açık ✓');
    // Restore the same encrypted record, proving signing survives recovery rather
    // than relying on an in-memory CryptoKey or fake platform credential.
    const backup = structuredClone(items); items = []; await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'NATIVE_SYNC' }));
    items = backup;
    await start('get', getOptions); await reloadPopup(); await popup.locator('[data-action="approve-passkey"]').click();
    await expect.poll(() => page.evaluate(() => Boolean(window.result))).toBe(true);
    assert.equal((await verifyAuthenticationResponse({ ...verifyOptions, response: await page.evaluate(() => window.result) })).verified, true);
    t.diagnostic('protected cancel, AbortSignal, lock/unlock and encrypted record recovery passed');
    await start('get', getOptions);
    const cdp = await context.newCDPSession(popup);
    const { targetInfos } = await cdp.send('Target.getTargets');
    const workerTarget = targetInfos.find(info => info.type === 'service_worker' && info.url.includes(id));
    assert.ok(workerTarget); await cdp.send('Target.closeTarget', { targetId: workerTarget.targetId });
    await expect.poll(() => page.evaluate(() => window.error)).toBe('NotAllowedError');
    await reloadPopup(); await expect(popup.locator('#vault-status')).toHaveText('Kasa Kilidi Açık ✓');
    await start('get', getOptions); await reloadPopup(); await popup.locator('[data-action="approve-passkey"]').click();
    await expect.poll(() => page.evaluate(() => Boolean(window.result))).toBe(true);
    t.diagnostic('worker restart cancels pending approval and restored unlocked session can sign a new request');
    const duplicate = await generateRegistrationOptions({ rpName: 'Synthetic', rpID, userName: 'synthetic-rp-account', userID: new TextEncoder().encode('rp-user'), excludeCredentials: [{ id: credential.id }], authenticatorSelection: { userVerification: 'preferred' } });
    await start('create', duplicate); await reloadPopup(); await popup.locator('[data-action="approve-passkey"]').click();
    await expect.poll(() => page.evaluate(() => window.error)).toBe('NotAllowedError'); assert.equal(items.length, 1);
    await start('get', getOptions); await reloadPopup();
    // Capture only the protected approval capability; no page ever receives it.
    const entries = await popup.evaluate(async () => { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); return chrome.runtime.sendMessage({ type: 'PASSKEY_LIST', tabId: tab.id }); });
    assert.ok(entries.payload[0].approvalId);
    await page.goto(origin + '/new-document');
    const stale = await popup.evaluate(approvalId => chrome.runtime.sendMessage({ type: 'PASSKEY_APPROVE', approvalId }), entries.payload[0].approvalId);
    assert.equal(stale.ok, false);
    // Foreign RP IDs remain under the native browser's validation.
    const mismatched = await page.evaluate(async () => { try { await navigator.credentials.get({ publicKey: { challenge: new Uint8Array(32), rpId: 'evil.test', timeout: 1000 } }); return 'accepted'; } catch (error) { return error.name; } });
    assert.equal(mismatched, 'SecurityError');
    t.diagnostic('document navigation and browser RP mismatch validation passed');
    await start('get', getOptions); revoked = true; await reloadPopup();
    await expect.poll(() => page.evaluate(() => window.error)).toBe('NotAllowedError');
    t.diagnostic('excluded duplicate and remote session revocation passed');
  } finally {
    await context?.close(); await new Promise(resolve => server.close(resolve)); await rm(temp, { recursive: true, force: true });
  }
});
