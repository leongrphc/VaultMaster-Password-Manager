import test from 'node:test';
import { createHash } from 'node:crypto';
import { sensitiveAction } from '../../packages/shared/dist/index.js';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { deriveMasterKey, generateAuthHash, encryptJSON, exportMasterKeyBase64, unwrapVaultKey, importMasterKey } from '../../packages/crypto/dist/index.js';

// Uses the built static export and intercepts every API request. No live account
// or production database is accessed. Run a static web build before this test.
test('web preserves its random data key through password change, reload and unlock', { timeout: 90000 }, async () => {
  const root = resolve('apps/web/out');
  await stat(join(root, 'index.html'));
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.txt': 'text/plain', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
  const headersText = await readFile(join(root, '_headers'), 'utf8');
  const csp = headersText.match(/Content-Security-Policy: ([^\r\n]+)/)?.[1];
  assert.ok(csp && !csp.match(/script-src[^;]*'unsafe-/));
  const server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      let file = resolve(root, '.' + pathname);
      if (file !== root && !file.startsWith(root + sep)) throw new Error('Invalid path');
      try { if ((await stat(file)).isDirectory()) file = join(file, 'index.html'); }
      catch { file += '.html'; }
      const bytes = await readFile(file);
      res.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream', 'content-security-policy': csp });
      res.end(bytes);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  let browser;
  try {
    const email = 'session-fixture@example.test';
    const password = 'Fixture-master-password-2026!';
    const passwordKey = await deriveMasterKey(password, email);
    let keyBase64;
    let encrypted;
    let vaultKeyEnvelope;
    const backupId = crypto.randomUUID();
    let restoreCalls = 0;
    let csvReceipt;
    let exportBytes;
    const restoreChunks = [];
    let sessionExpired = false;
    let refreshCalls = 0;
    const proofs = new Map();
    let reauthCalls = 0;
    const notifications = [];
    const timestamp = '2026-10-05T00:00:00.000Z';
    browser = await chromium.launch({ channel: 'chromium', headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.context().route('**/api/**', async route => {
      assert.equal(route.request().headers()['x-vaultmaster-client'], 'web');
      assert.equal(route.request().headers()['authorization'], undefined);
      const pathname = new URL(route.request().url()).pathname;
      if (sessionExpired && !pathname.endsWith('/auth/refresh')) {
        return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'Expired fixture session' }) });
      }
      const action = sensitiveAction(route.request().method(), pathname.replace(/^\/api/, ''));
      if (action) {
        const proof = route.request().headers()['x-vaultmaster-reauth'];
        assert.equal(proofs.get(proof), `${route.request().method()} ${pathname.replace(/^\/api/, '')}`);
        proofs.delete(proof);
      }
      let data;
      if (pathname.endsWith('/auth/register')) {
        vaultKeyEnvelope = { ...route.request().postDataJSON().vaultKeyEnvelope, version: 1 };
        const key = await unwrapVaultKey(vaultKeyEnvelope, passwordKey);
        keyBase64 = await exportMasterKeyBase64(key);
        encrypted = await encryptJSON({ type: 'login', title: 'Encrypted browser fixture', username: 'octo', password: 'fixture-secret', url: 'https://example.test' }, key);
        data = { user: { id: 'user-1', email, createdAt: timestamp }, session: true, deviceId: 'device-1', kdfSalt: email, kdfIterations: 600000, vaultKeyEnvelope };
      }
      else if (pathname.endsWith('/auth/reauthenticate')) {
        const body = route.request().postDataJSON();
        const currentPassword = vaultKeyEnvelope.version === 1 ? password : 'New-fixture-master-password-2026!';
        assert.equal(body.authHash, await generateAuthHash(await deriveMasterKey(currentPassword, email), currentPassword));
        const proof = crypto.randomUUID(); proofs.set(proof, `${body.method} ${body.path}`); reauthCalls++;
        data = { proof, expiresIn: 300 };
      }
      else if (pathname.endsWith('/auth/security-notifications')) data = notifications;
      else if (pathname.endsWith('/backups/import-state')) data = { state: 'a'.repeat(64), folders: [], items: [{ id: '00000000-0000-4000-8000-000000000001', folderId: null, favorite: false, deletedAt: null, encryptedData: encrypted.ciphertext, iv: encrypted.iv, createdAt: timestamp, updatedAt: timestamp, _count: { versions: 0, attachments: 0 } }] };
      else if (pathname.endsWith('/backups/snapshot')) {
        const snapshot = { backupId, exportedAt: timestamp, sourceEmail: email, snapshot: { folders: [], items: [{
          id: crypto.randomUUID(), folderId: null, favorite: false, deletedAt: null,
          encryptedData: encrypted.ciphertext, iv: encrypted.iv, createdAt: timestamp, updatedAt: timestamp,
          versions: [], attachments: [],
        }] } };
        exportBytes = Buffer.from(JSON.stringify(snapshot));
        data = { transferId: 'export-transfer', totalBytes: exportBytes.length, chunkCount: 1 };
      }
      else if (pathname.endsWith('/backups/transfers/export-transfer/chunks/0')) data = { index: 0, data: exportBytes.toString('base64') };
      else if (pathname.endsWith('/backups/transfers') && route.request().method() === 'POST') {
        restoreChunks.length = 0;
        data = { transferId: 'restore-transfer' };
      }
      else if (pathname.endsWith('/backups/transfers/restore-transfer/chunks')) {
        const chunk = route.request().postDataJSON();
        restoreChunks[chunk.index] = Buffer.from(chunk.data, 'base64');
        assert.ok(!JSON.stringify(chunk).includes(keyBase64));
        data = {};
      }
      else if (pathname.endsWith('/backups/transfers/restore-transfer/commit')) {
        const body = JSON.parse(Buffer.concat(restoreChunks).toString('utf8'));
        if (body.backupId === backupId) assert.equal(body.snapshot.items.length, 0);
        else if (body.snapshot.items.length) { assert.equal(body.review.overwriteApproved, true); assert.equal(Object.values(body.review.replacements)[0], '00000000-0000-4000-8000-000000000001'); assert.equal(body.snapshot.items.length, 1); }
        assert.ok(body.review);
        assert.ok(!JSON.stringify(body).includes(keyBase64));
        assert.ok(!JSON.stringify(body).includes('fixture-secret'));
        assert.ok(!JSON.stringify(body).includes('changed-fixture-secret'));
        if (body.snapshot.items.length && !csvReceipt) {
          csvReceipt = JSON.stringify(body); restoreCalls++;
          // The synthetic server committed, but its response was lost.
          return route.abort('failed');
        }
        if (body.snapshot.items.length) {
          assert.equal(JSON.stringify(body), csvReceipt);
          data = { alreadyRestored: true, counts: { folders: 0, items: 1, trash: 0, versions: 0, attachments: 0 } };
        } else data = { alreadyRestored: false, counts: { folders: 0, items: 0, trash: 0, versions: 0, attachments: 0 } };
        if (!body.snapshot.items.length) restoreCalls++;
      }
      else if (pathname.includes('/backups/transfers/') && route.request().method() === 'DELETE') data = {};
      else if (pathname.endsWith('/auth/change-password')) {
        const body = route.request().postDataJSON();
        assert.equal(body.expectedVaultKeyVersion, 1);
        assert.ok(!('items' in body));
        const nextPasswordKey = await deriveMasterKey('New-fixture-master-password-2026!', email);
        assert.equal(await exportMasterKeyBase64(await unwrapVaultKey(body.vaultKeyEnvelope, nextPasswordKey)), keyBase64);
        notifications.push({ id: 'password-notification', action: 'security.password.change', message: 'Ana şifre değiştirildi. Diğer cihazların oturumları kapatıldı; mevcut oturum açık kaldı.', createdAt: timestamp, readAt: timestamp });
        vaultKeyEnvelope = { ...body.vaultKeyEnvelope, version: 2 };
        data = { message: 'Ana şifre güncellendi', vaultKeyEnvelope };
      }
      else if (pathname.endsWith('/devices') || pathname.endsWith('/audit-events') || pathname.endsWith('/auth/webauthn/credentials')) data = [];
      else if (pathname.endsWith('/auth/2fa/status')) data = { enabled: false, recoveryCodesRemaining: 0 };
      else if (pathname.endsWith('/auth/vault-key')) data = { vaultKeyEnvelope };
      else if (pathname.endsWith('/auth/me')) data = { id: 'user-1', email };
      else if (pathname.endsWith('/auth/refresh')) {
        refreshCalls++;
        await new Promise(done => setTimeout(done, 100));
        sessionExpired = false;
        data = { session: true, deviceId: 'device-1' };
      }
      else if (pathname.endsWith('/auth/logout')) data = { message: 'Çıkış yapıldı' };
      else if (pathname.endsWith('/vault')) data = [{ id: 'item-1', folderId: null, favorite: false, encryptedData: encrypted.ciphertext, iv: encrypted.iv, createdAt: timestamp, updatedAt: timestamp }];
      else if (pathname.endsWith('/folders')) data = [];
      else throw new Error(`Unexpected API request: ${pathname}`);
      return route.fulfill({ status: pathname.endsWith('/register') ? 201 : 200,
        headers: pathname.endsWith('/register') ? { 'set-cookie': '__Host-vaultmaster-access=fixture-cookie; Path=/; HttpOnly; Secure; SameSite=Strict' } : {},
        contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole('button', { name: 'Hesabınız yok mu? Kayıt olun' }).click();
    await page.getByLabel('E-posta').fill(email);
    await page.getByLabel('Ana Şifre', { exact: true }).fill(password);
    await page.getByLabel('Ana Şifre (Tekrar)').fill(password);
    await page.getByLabel(/Ana şifremi unutursam/).check();
    await page.getByRole('button', { name: /^Hesap Oluştur/ }).click();
    await expect(page.getByText('Encrypted browser fixture', { exact: true }).first()).toBeVisible();
    // P1-4: real Chromium, real WebCrypto and built CSP; provider responses are synthetic.
    let breachMode = 'wait';
    const pendingBreaches = [];
    const breachRequests = [];
    const abortedBreaches = [];
    page.on('requestfailed', request => {
      if (request.url().startsWith('https://api.pwnedpasswords.com/')) abortedBreaches.push(request.failure()?.errorText);
    });
    const digest = createHash('sha1').update('fixture-secret').digest('hex').toUpperCase();
    await context.route('https://api.pwnedpasswords.com/range/*', async route => {
      const request = route.request();
      breachRequests.push(request);
      assert.equal(request.url(), `https://api.pwnedpasswords.com/range/${digest.slice(0, 5)}`);
      assert.equal(request.headers()['add-padding'], 'true');
      for (const name of ['cookie', 'authorization', 'referer']) assert.equal(request.headers()[name], undefined);
      assert.equal(request.postData(), null);
      if (breachMode === 'wait') { pendingBreaches.push(route); return; }
      return route.fulfill({ status: breachMode === 'http-error' ? 503 : 200,
        contentType: 'text/plain', body: breachMode === 'malformed' ? 'PRIVATE provider failure' : `${digest.slice(5)}:7\r\n${'0'.repeat(35)}:0` });
    });
    await page.getByRole('link', { name: 'Sağlık Raporu' }).click();
    await expect(page.getByRole('heading', { name: 'Şifre Sağlık Raporu' })).toBeVisible();
    assert.equal(breachRequests.length, 0);
    await expect(page.getByText(/HIBP IP adresinizi/)).toBeVisible();
    await expect(page.getByText('Encrypted browser fixture', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Kontrol Et', exact: true }).click();
    await expect.poll(() => pendingBreaches.length).toBe(1);
    await expect(page.getByText('0 / 1 şifre kontrol edildi')).toBeVisible();
    await expect(page.getByRole('progressbar', { name: 'Geçerli aşama; süre bilinmiyor' })).not.toHaveAttribute('value');
    await expect(page.getByText(/kontrolü tamamlandı/)).toHaveCount(0);
    await page.getByRole('button', { name: 'İptal', exact: true }).evaluate(button => { button.click(); button.click(); });
    await expect(page.getByText(/Kontrol iptal edildi/)).toBeVisible();
    await pendingBreaches.shift().fulfill({ status: 200, body: `${digest.slice(5)}:99` }).catch(() => {});
    await expect.poll(() => abortedBreaches.length).toBe(1);
    assert.match(abortedBreaches[0], /ABORTED/);
    await expect(page.getByText(/99 kez/)).toHaveCount(0);
    for (const mode of ['http-error', 'malformed']) {
      breachMode = mode;
      await page.getByRole('button', { name: 'Kontrol Et', exact: true }).click();
      await expect(page.getByText(/Kontrol tamamlanamadı/)).toBeVisible();
      await expect(page.getByText(/PRIVATE provider failure/)).toHaveCount(0);
    }
    breachMode = 'success';
    await page.getByRole('button', { name: 'Kontrol Et', exact: true }).click();
    await expect(page.getByText(/kontrolü tamamlandı/)).toBeVisible();
    await expect(page.getByText('1 / 1 şifre kontrol edildi')).toBeVisible();
    await expect(page.getByText('7 kez sızdırılmış')).toBeVisible();
    const reportStorage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
    assert.ok(!reportStorage.includes('fixture-secret'));
    assert.ok(!reportStorage.includes(digest));
    breachMode = 'wait';
    await page.getByRole('button', { name: 'Kontrol Et', exact: true }).click();
    await expect.poll(() => pendingBreaches.length).toBe(1);
    await page.getByRole('link', { name: 'Tüm Öğeler' }).click();
    await expect(page.getByText('Encrypted browser fixture', { exact: true }).first()).toBeVisible();
    await pendingBreaches.shift().fulfill({ status: 200, body: `${digest.slice(5)}:99` }).catch(() => {});
    await page.getByRole('link', { name: 'Sağlık Raporu' }).click();
    await expect(page.getByRole('button', { name: 'Kontrol Et', exact: true })).toBeEnabled();
    await expect(page.getByText(/kez sızdırılmış/)).toHaveCount(0);
    await page.getByRole('button', { name: 'Kontrol Et', exact: true }).click();
    await expect.poll(() => pendingBreaches.length).toBe(1);
    await page.getByRole('button', { name: 'Kasayı Kilitle' }).click();
    await expect(page.getByRole('heading', { name: 'Kasa Kilitli' })).toBeVisible();
    await pendingBreaches.shift().fulfill({ status: 200, body: `${digest.slice(5)}:99` }).catch(() => {});
    await page.getByLabel('Ana Şifre', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Ana şifre ile kilidi aç' }).click();
    await expect(page.getByRole('button', { name: 'Kontrol Et', exact: true })).toBeEnabled();
    await expect(page.getByText(/kez sızdırılmış/)).toHaveCount(0);
    await page.getByRole('link', { name: 'Tüm Öğeler' }).click();
    const persisted = await page.evaluate(() => ({ local: JSON.stringify({ ...localStorage }), session: JSON.stringify({ ...sessionStorage }) }));
    assert.ok(!persisted.local.includes(keyBase64));
    assert.ok(!persisted.session.includes(keyBase64));
    assert.ok(!persisted.local.includes('fixture-secret'));
    assert.ok(!persisted.local.includes('fixture-cookie'));
    assert.ok(!JSON.parse(await page.evaluate(() => localStorage.getItem('vaultmaster-auth'))).state.tokens);
    assert.ok(!(await page.evaluate(() => document.cookie)).includes('fixture-cookie'));
    await page.evaluate(() => { window.cspViolations = []; document.addEventListener('securitypolicyviolation', event => window.cspViolations.push(event.violatedDirective)); const script = document.createElement('script'); script.textContent = 'window.untrustedScriptExecuted = true'; document.body.appendChild(script); });
    await expect.poll(() => page.evaluate(() => window.cspViolations)).toContain('script-src-elem');
    assert.equal(await page.evaluate(() => window.untrustedScriptExecuted), undefined);
    await page.evaluate(value => sessionStorage.setItem('vaultmaster-session-master-key', value), keyBase64);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Kasa Kilitli' })).toBeVisible();
    await expect(page.getByText('Encrypted browser fixture', { exact: true })).toHaveCount(0);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('vaultmaster-session-master-key')), null);
    await page.getByLabel('Ana Şifre', { exact: true }).fill('wrong-master-password');
    await page.getByRole('button', { name: 'Ana şifre ile kilidi aç' }).click();
    await expect(page.getByText('Yanlış ana şifre', { exact: true })).toBeVisible();
    await page.getByLabel('Ana Şifre', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Ana şifre ile kilidi aç' }).click();
    await expect(page.getByText('Encrypted browser fixture', { exact: true }).first()).toBeVisible();
    assert.equal(await page.evaluate(() => sessionStorage.getItem('vaultmaster-session-master-key')), null);
    await page.getByRole('link', { name: 'Ayarlar' }).click();
    await page.getByRole('button', { name: 'Güvenlik', exact: true }).click();
    await page.getByPlaceholder('Mevcut ana şifre', { exact: true }).fill(password);
    await page.getByPlaceholder('Yeni ana şifre', { exact: true }).fill('New-fixture-master-password-2026!');
    await page.getByPlaceholder('Yeni ana şifre (tekrar)', { exact: true }).fill('New-fixture-master-password-2026!');
    await page.getByRole('button', { name: 'Ana Şifreyi Güncelle', exact: true }).click();
    await page.getByRole('button', { name: 'Doğrula ve devam et' }).click();
    await expect(page.getByText('Ana şifre güncellendi. Diğer cihazların oturumları kapatıldı; mevcut oturum açık kaldı.', { exact: true })).toBeVisible();
    await page.getByRole('region', { name: 'Güvenlik bildirimleri' }).getByRole('button', { name: 'Yenile' }).click();
    await expect(page.getByText(notifications[0].message, { exact: true })).toBeVisible();
    const storedAfterChange = await page.evaluate(() => localStorage.getItem('vaultmaster-auth'));
    assert.equal(JSON.parse(storedAfterChange).state.vaultKeyEnvelope.version, 2);
    assert.ok(!storedAfterChange.includes(keyBase64));
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Kasa Kilitli' })).toBeVisible();
    await page.getByLabel('Ana Şifre', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Ana şifre ile kilidi aç' }).click();
    await expect(page.getByText('Yanlış ana şifre', { exact: true })).toBeVisible();
    await page.getByLabel('Ana Şifre', { exact: true }).fill('New-fixture-master-password-2026!');
    await page.getByRole('button', { name: 'Ana şifre ile kilidi aç' }).click();
    await expect(page.getByRole('heading', { name: 'Kasa Kilitli' })).toHaveCount(0);
    await page.getByRole('link', { name: 'Tüm Öğeler' }).click();
    await expect(page.getByText('Encrypted browser fixture', { exact: true }).first()).toBeVisible();
    await page.getByRole('link', { name: 'Ayarlar' }).click();
    await page.getByRole('button', { name: 'Veri Yönetimi', exact: true }).click();
    await page.getByLabel('Yeni yedek şifresi', { exact: true }).fill('Independent-backup-password-2026!');
    await page.getByLabel('Yedek şifresi tekrar', { exact: true }).fill('Independent-backup-password-2026!');
    const downloadReady = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Tam Yedeği İndir', exact: true }).click();
    await page.getByLabel('Ana şifre', { exact: true }).fill('New-fixture-master-password-2026!');
    await page.getByRole('button', { name: 'Doğrula ve devam et' }).click();
    const download = await downloadReady;
    assert.equal(reauthCalls, 2);
    const backupText = await readFile(await download.path(), 'utf8');
    assert.equal(JSON.parse(backupText).version, 4);
    assert.ok(!backupText.includes(keyBase64));
    assert.ok(!backupText.includes('fixture-secret'));
    await page.getByLabel('Tam yedek dosyası').setInputFiles({ name: 'portable-backup.json', mimeType: 'application/json', buffer: Buffer.from(backupText) });
    await page.getByLabel('Geri yüklenecek yedeğin şifresi').fill('wrong-password');
    await page.getByRole('button', { name: 'Yedeği Kontrol Et' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Yedek işlemi tamamlanamadı' })).toBeVisible();
    assert.equal(restoreCalls, 0);
    await page.getByLabel('Geri yüklenecek yedeğin şifresi').fill('Independent-backup-password-2026!');
    await page.getByRole('button', { name: 'Yedeği Kontrol Et' }).click();
    await expect(page.getByRole('button', { name: 'İncelemeyi Onayla ve İçe Aktar' })).toBeVisible();
    assert.equal(restoreCalls, 0);
    await page.getByRole('button', { name: 'İncelemeyi Onayla ve İçe Aktar' }).click();
    await expect(page.getByText('Tam yedek başarıyla geri yüklendi.', { exact: true })).toBeVisible();
    assert.equal(restoreCalls, 1);
    // CSV review shows only fixed labels; no request commits until separate
    // overwrite approval. Cancel leaves the vault unchanged.
    const csv = 'title,url,username,password\nChanged,https://example.test/new,octo,changed-fixture-secret';
    const fileInput = page.locator('input[type="file"]').last();
    await fileInput.setInputFiles({ name: 'synthetic.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    const review = page.getByLabel('İçe aktarma incelemesi');
    await expect(review).toBeVisible();
    assert.ok(!(await review.innerText()).includes('changed-fixture-secret'));
    assert.ok(!(await review.innerText()).includes('octo'));
    assert.equal(restoreCalls, 1);
    await review.getByRole('button', { name: 'İptal', exact: true }).click();
    assert.equal(restoreCalls, 1);
    await fileInput.setInputFiles({ name: 'synthetic.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await expect(review).toBeVisible();
    await review.getByLabel('Kayıt 1 kararı').selectOption('replace');
    await expect(review.getByRole('button', { name: 'İncelemeyi Onayla ve İçe Aktar' })).toBeDisabled();
    await review.getByRole('checkbox').check();
    await review.getByRole('button', { name: 'İncelemeyi Onayla ve İçe Aktar' }).click();
    await expect(page.getByText('1 öğe başarıyla içe aktarıldı', { exact: true })).toBeVisible();
    assert.equal(restoreCalls, 2);
    const legacy = await encryptJSON({ version: '2.0', exportDate: timestamp, itemCount: 1, folderCount: 0, folders: [], items: [{ data: { type: 'login', title: 'Encrypted browser fixture', username: 'octo', password: 'fixture-secret', url: 'https://example.test' }, folderId: null, favorite: false }] }, await importMasterKey(keyBase64));
    await fileInput.setInputFiles({ name: 'legacy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ encrypted: true, ...legacy })) });
    await expect(review.getByText('Kayıt 1: Aynı kayıt — atlanacak')).toBeVisible();
    assert.equal(restoreCalls, 2);
    await review.getByRole('button', { name: 'İncelemeyi Onayla ve İçe Aktar' }).click();
    await expect(page.getByText('0 öğe başarıyla içe aktarıldı', { exact: true })).toBeVisible();
    assert.equal(restoreCalls, 3);
    const secondTab = await page.context().newPage();
    secondTab.on('pageerror', error => pageErrors.push(error.message));
    await secondTab.goto(`http://127.0.0.1:${server.address().port}/vault/`);
    await expect(secondTab.getByRole('heading', { name: 'Kasa Kilitli' })).toBeVisible();
    // Rehydration starts locked and propagates that lock to the existing tab.
    await expect(page.getByRole('heading', { name: 'Kasa Kilitli' })).toBeVisible();
    for (const tab of [page, secondTab]) {
      await tab.getByLabel('Ana Şifre', { exact: true }).fill('New-fixture-master-password-2026!');
      await tab.getByRole('button', { name: 'Ana şifre ile kilidi aç' }).click();
      await expect(tab.getByRole('heading', { name: 'Kasa Kilitli' })).toHaveCount(0);
    }
    await page.getByRole('button', { name: 'Kasayı Kilitle' }).click();
    await expect(secondTab.getByRole('heading', { name: 'Kasa Kilitli' })).toBeVisible();
    sessionExpired = true;
    await Promise.all([page, secondTab].map(async tab => {
      await tab.getByLabel('Ana Şifre', { exact: true }).fill('New-fixture-master-password-2026!');
      await tab.getByRole('button', { name: 'Ana şifre ile kilidi aç' }).click();
      await expect(tab.getByRole('heading', { name: 'Kasa Kilitli' })).toHaveCount(0);
    }));
    assert.equal(refreshCalls, 1, 'tabs must share one refresh rotation for the expired cookie');
    await page.getByRole('button', { name: 'Kasayı Kilitle' }).click();
    await expect(secondTab.getByRole('heading', { name: 'Kasa Kilitli' })).toBeVisible();
    await expect(secondTab.getByText('Encrypted browser fixture', { exact: true })).toHaveCount(0);
    await secondTab.getByRole('button', { name: 'Farklı hesap ile giriş yap' }).click();
    await expect(page.getByLabel('E-posta')).toBeVisible();
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser?.close();
    await new Promise(done => server.close(done));
  }
});
