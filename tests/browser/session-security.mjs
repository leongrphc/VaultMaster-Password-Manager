import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { deriveMasterKey, encryptJSON, exportMasterKeyBase64, unwrapVaultKey } from '../../packages/crypto/dist/index.js';

// Uses the built static export and intercepts every API request. No live account
// or production database is accessed. Run a static web build before this test.
test('web preserves its random data key through password change, reload and unlock', { timeout: 90000 }, async () => {
  const root = resolve('apps/web/out');
  await stat(join(root, 'index.html'));
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.txt': 'text/plain', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
  const server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      let file = resolve(root, '.' + pathname);
      if (file !== root && !file.startsWith(root + sep)) throw new Error('Invalid path');
      try { if ((await stat(file)).isDirectory()) file = join(file, 'index.html'); }
      catch { file += '.html'; }
      const bytes = await readFile(file);
      res.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream' });
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
    const timestamp = '2026-10-05T00:00:00.000Z';
    browser = await chromium.launch({ channel: 'chromium', headless: true });
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.route('**/api/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      let data;
      if (pathname.endsWith('/auth/register')) {
        vaultKeyEnvelope = { ...route.request().postDataJSON().vaultKeyEnvelope, version: 1 };
        const key = await unwrapVaultKey(vaultKeyEnvelope, passwordKey);
        keyBase64 = await exportMasterKeyBase64(key);
        encrypted = await encryptJSON({ type: 'login', title: 'Encrypted browser fixture', username: 'octo', password: 'fixture-secret', url: 'https://example.test' }, key);
        data = { user: { id: 'user-1', email, createdAt: timestamp }, tokens: { accessToken: 'fixture-access', refreshToken: 'fixture-refresh' }, deviceId: 'device-1', kdfSalt: email, kdfIterations: 600000, vaultKeyEnvelope };
      }
      else if (pathname.endsWith('/backups/snapshot')) {
        data = { backupId, exportedAt: timestamp, sourceEmail: email, snapshot: { folders: [], items: [{
          id: crypto.randomUUID(), folderId: null, favorite: false, deletedAt: null,
          encryptedData: encrypted.ciphertext, iv: encrypted.iv, createdAt: timestamp, updatedAt: timestamp,
          versions: [], attachments: [],
        }] } };
      }
      else if (pathname.endsWith('/backups/restore')) {
        const body = route.request().postDataJSON();
        assert.equal(body.backupId, backupId);
        assert.ok(!JSON.stringify(body).includes(keyBase64));
        assert.ok(!JSON.stringify(body).includes('fixture-secret'));
        data = { alreadyRestored: restoreCalls++ > 0, counts: { folders: 0, items: 1, trash: 0, versions: 0, attachments: 0 } };
      }
      else if (pathname.endsWith('/auth/change-password')) {
        const body = route.request().postDataJSON();
        assert.equal(body.expectedVaultKeyVersion, 1);
        assert.ok(!('items' in body));
        const nextPasswordKey = await deriveMasterKey('New-fixture-master-password-2026!', email);
        assert.equal(await exportMasterKeyBase64(await unwrapVaultKey(body.vaultKeyEnvelope, nextPasswordKey)), keyBase64);
        vaultKeyEnvelope = { ...body.vaultKeyEnvelope, version: 2 };
        data = { message: 'Ana şifre güncellendi', vaultKeyEnvelope };
      }
      else if (pathname.endsWith('/devices') || pathname.endsWith('/audit-events') || pathname.endsWith('/auth/webauthn/credentials')) data = [];
      else if (pathname.endsWith('/auth/2fa/status')) data = { enabled: false, recoveryCodesRemaining: 0 };
      else if (pathname.endsWith('/auth/vault-key')) data = { vaultKeyEnvelope };
      else if (pathname.endsWith('/vault')) data = [{ id: 'item-1', folderId: null, favorite: false, encryptedData: encrypted.ciphertext, iv: encrypted.iv, createdAt: timestamp, updatedAt: timestamp }];
      else if (pathname.endsWith('/folders')) data = [];
      else throw new Error(`Unexpected API request: ${pathname}`);
      return route.fulfill({ status: pathname.endsWith('/register') ? 201 : 200,
        headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type' },
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
    const persisted = await page.evaluate(() => ({ local: JSON.stringify({ ...localStorage }), session: JSON.stringify({ ...sessionStorage }) }));
    assert.ok(!persisted.local.includes(keyBase64));
    assert.ok(!persisted.session.includes(keyBase64));
    assert.ok(!persisted.local.includes('fixture-secret'));
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
    await expect(page.getByText('Ana şifre güncellendi', { exact: true })).toBeVisible();
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
    const download = await downloadReady;
    const backupText = await readFile(await download.path(), 'utf8');
    assert.ok(!backupText.includes(keyBase64));
    assert.ok(!backupText.includes('fixture-secret'));
    await page.getByLabel('Tam yedek dosyası').setInputFiles({ name: 'portable-backup.json', mimeType: 'application/json', buffer: Buffer.from(backupText) });
    await page.getByLabel('Geri yüklenecek yedeğin şifresi').fill('wrong-password');
    await page.getByRole('button', { name: 'Yedeği Kontrol Et' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Yedek açılamadı' })).toBeVisible();
    assert.equal(restoreCalls, 0);
    await page.getByLabel('Geri yüklenecek yedeğin şifresi').fill('Independent-backup-password-2026!');
    await page.getByRole('button', { name: 'Yedeği Kontrol Et' }).click();
    await expect(page.getByRole('button', { name: 'Mevcut Kasaya Ekle' })).toBeVisible();
    assert.equal(restoreCalls, 0);
    await page.getByRole('button', { name: 'Mevcut Kasaya Ekle' }).click();
    await expect(page.getByText('Tam yedek başarıyla geri yüklendi.', { exact: true })).toBeVisible();
    assert.equal(restoreCalls, 1);
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser?.close();
    await new Promise(done => server.close(done));
  }
});
