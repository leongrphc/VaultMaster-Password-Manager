import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { deriveMasterKey, encryptJSON, exportMasterKeyBase64 } from '../../packages/crypto/dist/index.js';

// Uses the built static export and intercepts every API request. No live account
// or production database is accessed. Run a static web build before this test.
test('web keeps its key in memory and requires unlock after a full reload', { timeout: 60000 }, async () => {
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
    const key = await deriveMasterKey(password, email);
    const keyBase64 = await exportMasterKeyBase64(key);
    const encrypted = await encryptJSON({ type: 'login', title: 'Encrypted browser fixture', username: 'octo', password: 'fixture-secret', url: 'https://example.test' }, key);
    const timestamp = '2026-10-05T00:00:00.000Z';
    browser = await chromium.launch({ channel: 'chromium', headless: true });
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.route('**/api/**', route => {
      const pathname = new URL(route.request().url()).pathname;
      let data;
      if (pathname.endsWith('/auth/register')) data = { user: { id: 'user-1', email, createdAt: timestamp }, tokens: { accessToken: 'fixture-access', refreshToken: 'fixture-refresh' }, deviceId: 'device-1', kdfSalt: email, kdfIterations: 600000 };
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
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser?.close();
    await new Promise(done => server.close(done));
  }
});
