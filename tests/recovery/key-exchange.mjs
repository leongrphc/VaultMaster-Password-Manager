import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createVaultKey, deriveMasterKey, generateAuthHash, wrapVaultKey, encryptJSON, decryptJSON, contactFingerprint } from '../../packages/crypto/dist/index.js';
// This real API/browser suite runs only with an explicit synthetic test database.
// The isolated harness discards deployment env and disables PostgreSQL TCP.
if (!process.env.VAULTMASTER_TEST_DATABASE_URL) throw new Error('Explicit disposable test database required');
test('Chromium sharing and emergency recovery use real WebCrypto/API/PostgreSQL and explicit approvals', { timeout: 180000 }, async () => {
  const root = resolve(new URL('../../apps/web/out', import.meta.url).pathname);
  const csp = (await readFile(join(root, '_headers'), 'utf8')).match(/Content-Security-Policy: ([^\r\n]+)/)?.[1];
  assert.ok(csp);
  let upstream, browser, apiServer, approvalIndex = 0;
  const failures = [];
  const web = createServer(async (req, res) => {
    try {
      if (req.url.startsWith('/api/')) {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const headers = { ...req.headers }; delete headers.host; delete headers.connection;
        const response = await fetch(upstream + req.url, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks), redirect: 'manual' });
        res.writeHead(response.status, { ...Object.fromEntries([...response.headers].filter(([k]) => !['content-encoding', 'content-length', 'set-cookie'].includes(k))), 'set-cookie': response.headers.getSetCookie() });
        res.end(Buffer.from(await response.arrayBuffer())); return;
      }
      let file = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
      if (!file.startsWith(root + sep) && file !== root) throw new Error('Invalid path');
      try { if ((await stat(file)).isDirectory()) file = join(file, 'index.html'); } catch { file += '.html'; }
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.txt': 'text/plain', '.json': 'application/json' };
      res.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream', 'content-security-policy': csp }); res.end(await readFile(file));
    } catch { res.writeHead(500); res.end(); }
  });
  await new Promise(done => web.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${web.address().port}`;
  process.env.CORS_ORIGIN = origin;
  const { startTestServer, stopTestServer, registerUser, authHeaders, request, cleanupIntegrationUsers } = await import('../../apps/api/tests/integration-helpers.mjs');
  const { prisma } = await import('../../apps/api/dist/config/prisma.js');
  try {
    const started = await startTestServer(); upstream = started.baseUrl; apiServer = started.server;
    const password = 'Synthetic-browser-password-2026!';
    const sourceKey = await createVaultKey();
    const wrapping = await deriveMasterKey(password, 'owner-' + process.pid + '@example.integration.test');
    const owner = await registerUser(upstream, { email: 'owner-' + process.pid + '@example.integration.test', authHash: await generateAuthHash(wrapping, password), vaultKeyEnvelope: await wrapVaultKey(sourceKey, wrapping) });
    const recipientKey = await createVaultKey();
    const recipientEmail = 'recipient-' + process.pid + '@example.integration.test';
    const recipientWrapping = await deriveMasterKey(password, recipientEmail);
    const recipient = await registerUser(upstream, { email: recipientEmail, authHash: await generateAuthHash(recipientWrapping, password), vaultKeyEnvelope: await wrapVaultKey(recipientKey, recipientWrapping) });
    const payload = { type: 'login', title: 'Synthetic browser shared item', username: 'fixture', password: 'never-uploaded-plaintext', url: 'https://example.test' };
    const encrypted = await encryptJSON(payload, sourceKey);
    const created = await request(upstream, '/api/vault', { method: 'POST', headers: authHeaders(owner.accessToken), body: { encryptedData: encrypted.ciphertext, iv: encrypted.iv, favorite: false } }); assert.equal(created.status, 201);
    browser = await chromium.launch({ channel: 'chromium', headless: true });
    const ownerContext = await browser.newContext(), recipientContext = await browser.newContext();
    const a = await ownerContext.newPage(), b = await recipientContext.newPage();
    const consoleText = [], errors = [], uploads = [];
    for (const page of [a, b]) {
      page.on('response', response => { if (response.url().includes('/api/') && response.status() >= 400) failures.push(response.status()); });
      page.on('console', message => consoleText.push(message.text())); page.on('pageerror', error => errors.push(error.message));
      page.on('request', req => { if (req.url().includes('/api/key-exchange') && req.postData()) uploads.push(req.postData()); });
      page.on('dialog', dialog => dialog.accept());
    }
    async function login(page, email) {
      await prisma.abuseBucket.deleteMany();
      await page.goto(origin); await page.getByLabel('E-posta').fill(email); await page.getByLabel('Ana Şifre', { exact: true }).fill(password);
      await page.getByRole('button', { name: /^Giriş Yap/ }).click(); await expect(page.getByRole('link', { name: 'Ayarlar' })).toBeVisible();
      await page.getByRole('link', { name: 'Ayarlar' }).click(); await page.getByRole('button', { name: 'Paylaşım', exact: true }).click();
    }
    async function approve(page, button, count = 1) {
      approvalIndex++;
      await prisma.abuseBucket.deleteMany(); await button.click();
      for (let i = 0; i < count; i++) {
        const dialog = page.getByRole('dialog', { name: 'Güvenlik doğrulaması' });
        await expect(dialog).toBeVisible(); await dialog.getByLabel('Ana şifre', { exact: true }).fill(password);
        const verified = page.waitForResponse(response => response.url().endsWith('/api/auth/reauthenticate') && response.request().method() === 'POST');
        await dialog.getByRole('button', { name: 'Doğrula ve devam et' }).click();
        assert.equal((await verified).status(), 200);
        if (i + 1 < count) {
          // Consecutive approvals may replace the same modal before a hidden
          // state is rendered. Wait for the next empty, ready password prompt.
          await expect(dialog.getByLabel('Ana şifre', { exact: true })).toHaveValue('');
          await expect(dialog.getByRole('button', { name: 'Doğrula ve devam et' })).toBeEnabled();
        } else await expect(dialog).toBeHidden();
      }
      await expect(page.getByRole('status').filter({ hasText: 'İşlem tamamlandı.' })).toBeVisible();
    }
    await login(a, owner.payload.email); await login(b, recipient.payload.email);
    await approve(a, a.getByRole('button', { name: 'Cihaz Kişi Kartı Oluştur' }));
    await approve(b, b.getByRole('button', { name: 'Cihaz Kişi Kartı Oluştur' }));
    const senderCard = await a.getByLabel('Kişi kartım', { exact: true }).inputValue(), recipientCard = await b.getByLabel('Kişi kartım', { exact: true }).inputValue();
    assert.equal((await contactFingerprint(JSON.parse(senderCard))).length, 64);
    await a.getByLabel('Doğrulanmış kişi kartı').fill(recipientCard); await a.getByLabel('Kişi kartını bağımsız güvenilir kanalda karşılaştırdım.').check();
    await a.getByLabel('Synthetic browser shared item', { exact: true }).check();
    await approve(a, a.getByRole('button', { name: 'Daveti Onayla ve Gönder' }));
    await prisma.abuseBucket.deleteMany(); await b.getByRole('button', { name: 'Davetleri Yenile' }).click();
    await b.getByLabel('Doğrulanmış kişi kartı').fill(senderCard); await b.getByLabel('Kişi kartını bağımsız güvenilir kanalda karşılaştırdım.').check();
    await approve(b, b.getByRole('button', { name: 'Daveti Kabul Et' }));
    // Browser-cookie concurrent replay: one stale proof is consumed exactly once.
    const shared = await prisma.exchangeGrant.findFirstOrThrow({ where: { kind: 'share' } });
    await prisma.abuseBucket.deleteMany();
    const replayStatuses = await b.evaluate(async ({ id, authHash }) => {
      const path = '/key-exchange/' + id + '/accept';
      const headers = { 'content-type': 'application/json', 'x-vaultmaster-client': 'web' };
      const issued = await fetch('/api/auth/reauthenticate', { method: 'POST', headers, body: JSON.stringify({ method: 'POST', path, authHash }) }).then(r => r.json());
      const options = { method: 'POST', headers: { ...headers, 'x-vaultmaster-reauth': issued.data.proof }, body: JSON.stringify({ revision: 0 }) };
      return Promise.all([fetch('/api' + path, options).then(r => r.status), fetch('/api' + path, options).then(r => r.status)]);
    }, { id: shared.id, authHash: recipient.payload.authHash });
    assert.deepEqual(replayStatuses.sort(), [403, 409]);
    await approve(b, b.getByRole('button', { name: 'Şifreyi Çöz ve İçe Aktarmayı İncele' }));
    await b.getByRole('button', { name: 'İncelemeyi Onayla ve İçe Aktar' }).click();
    await expect(b.getByLabel('İçe aktarma incelemesi')).toBeHidden();
    const recovered = await prisma.vaultItem.findMany({ where: { userId: recipient.data.user.id } }); assert.equal(recovered.length, 1); assert.deepEqual(await decryptJSON(recovered[0].encryptedData, recovered[0].iv, recipientKey), payload);
    // Repeat delivery uses the same import receipt: conflict review remains explicit.
    await approve(b, b.getByRole('button', { name: 'Şifreyi Çöz ve İçe Aktarmayı İncele' }));
    await expect(b.getByText('Öğe 1: Aynı öğe — atlanacak')).toBeVisible(); await b.getByRole('button', { name: 'İptal', exact: true }).click();
    await prisma.abuseBucket.deleteMany(); await a.getByRole('button', { name: 'Davetleri Yenile' }).click();
    await expect(a.getByText(/Paylaşım · accepted/)).toBeVisible();
    await approve(a, a.getByRole('button', { name: 'Erişimi İptal Et' }));
    await prisma.abuseBucket.deleteMany(); await b.getByRole('button', { name: 'Davetleri Yenile' }).click(); await expect(b.getByRole('button', { name: 'Şifreyi Çöz ve İçe Aktarmayı İncele' })).toHaveCount(0);
    await a.getByLabel('Erişim türü').selectOption('emergency'); await a.getByLabel('Bekleme saati').fill('1');
    await approve(a, a.getByRole('button', { name: 'Daveti Onayla ve Gönder' }));
    await prisma.abuseBucket.deleteMany(); await b.getByRole('button', { name: 'Davetleri Yenile' }).click(); await approve(b, b.getByRole('button', { name: 'Daveti Kabul Et' }));
    await approve(b, b.getByRole('button', { name: 'Acil Erişim Talep Et' }));
    const emergency = await prisma.exchangeGrant.findFirstOrThrow({ where: { kind: 'emergency' } }); assert.equal(emergency.envelope, null);
    await prisma.exchangeGrant.update({ where: { id: emergency.id }, data: { requestedAt: new Date(Date.now() - 3600001) } });
    await prisma.abuseBucket.deleteMany(); await a.getByRole('button', { name: 'Davetleri Yenile' }).click();
    const emergencyNote = { type: 'secure_note', title: 'Emergency synthetic note', content: 'synthetic-emergency-only-secret' };
    const noteCiphertext = await encryptJSON(emergencyNote, sourceKey);
    assert.equal((await request(upstream, '/api/vault', { method: 'POST', headers: authHeaders(owner.accessToken), body: { encryptedData: noteCiphertext.ciphertext, iv: noteCiphertext.iv, favorite: false } })).status, 201);
    await approve(a, a.getByRole('button', { name: 'Kasa Görüntüsünü Onayla ve Paylaş' }), 2);
    await prisma.abuseBucket.deleteMany(); await b.getByRole('button', { name: 'Davetleri Yenile' }).click();
    await approve(b, b.getByRole('button', { name: 'Şifreyi Çöz ve İçe Aktarmayı İncele' }));
    await expect(b.getByText(/2 öğe incelendi/)).toBeVisible();
    await expect(b.getByText(/Aynı öğe — atlanacak/)).toBeVisible();
    await b.getByRole('button', { name: 'İncelemeyi Onayla ve İçe Aktar' }).click();
    await expect(b.getByLabel('İçe aktarma incelemesi')).toBeHidden();
    const afterEmergency = await prisma.vaultItem.findMany({ where: { userId: recipient.data.user.id } });
    assert.equal(afterEmergency.length, 2);
    const contents = await Promise.all(afterEmergency.map(item => decryptJSON(item.encryptedData, item.iv, recipientKey)));
    assert.ok(contents.some(item => item.type === 'secure_note' && item.content === emergencyNote.content));
    // Expiry and owner device deletion suppress delivery on refresh.
    await prisma.exchangeGrant.update({ where: { id: emergency.id }, data: { expiresAt: new Date(0) } });
    await prisma.abuseBucket.deleteMany(); await b.getByRole('button', { name: 'Davetleri Yenile' }).click(); await expect(b.getByRole('button', { name: 'Şifreyi Çöz ve İçe Aktarmayı İncele' })).toHaveCount(0);
    // Lock discards all keys, contact approval and pending reviews; unlock retains DEK.
    await b.getByRole('button', { name: /Kilitle/ }).first().click();
    await expect(b.getByLabel('Doğrulanmış kişi kartı')).toHaveCount(0);
    await b.getByLabel('Ana Şifre', { exact: true }).fill(password); await b.getByRole('button', { name: /Kilidi aç/i }).click();
    await expect(b.getByRole('button', { name: 'Paylaşım', exact: true })).toBeVisible();
    await b.getByRole('button', { name: 'Paylaşım', exact: true }).click();
    await expect(b.getByRole('button', { name: 'Kişi Kartımı Göster' })).toBeVisible();
    await prisma.abuseBucket.deleteMany(); await b.getByRole('button', { name: 'Kişi Kartımı Göster' }).click(); await expect(b.getByLabel('Kişi kartım', { exact: true })).toHaveValue(recipientCard);
    // Re-enrollment/rotation is separate from share approval; old grants vanish.
    await a.getByLabel('Erişim türü').selectOption('share');
    await approve(a, a.getByRole('button', { name: 'Daveti Onayla ve Gönder' }));
    await prisma.abuseBucket.deleteMany(); await b.getByRole('button', { name: 'Davetleri Yenile' }).click();
    await b.getByLabel('Doğrulanmış kişi kartı').fill(senderCard); await b.getByLabel('Kişi kartını bağımsız güvenilir kanalda karşılaştırdım.').check();
    await approve(b, b.getByRole('button', { name: 'Daveti Kabul Et' }));
    const liveGrant = await prisma.exchangeGrant.findFirstOrThrow({ where: { kind: 'share', status: 'accepted' } });
    const owningKey = await prisma.exchangeKey.findUniqueOrThrow({ where: { id: liveGrant.senderKeyId } });
    await prisma.device.delete({ where: { id: owningKey.deviceId } });
    await prisma.abuseBucket.deleteMany();
    await b.getByRole('button', { name: 'Şifreyi Çöz ve İçe Aktarmayı İncele' }).click();
    const blockedDialog = b.getByRole('dialog', { name: 'Güvenlik doğrulaması' });
    await blockedDialog.getByLabel('Ana şifre', { exact: true }).fill(password); await blockedDialog.getByRole('button', { name: 'Doğrula ve devam et' }).click();
    await expect(b.getByRole('status').filter({ hasText: 'İşlem tamamlanamadı.' })).toBeVisible();
    await expect(b.getByLabel('İçe aktarma incelemesi')).toHaveCount(0);
    assert.equal(uploads.some(body => body.includes(payload.password)), false);
    assert.equal(consoleText.some(line => [password, payload.password, owner.payload.email, recipient.payload.email].some(secret => line.includes(secret))), false);
    assert.deepEqual(errors, []);
  } catch (failure) {
    // Keep Playwright's value dumps (cards/ciphertext/credentials) out of logs.
    const location = String(failure.stack).match(/key-exchange\.mjs:(\d+):\d+/)?.[1] || 'unknown';
    throw new Error('Synthetic Chromium check failed at scenario line ' + location + '; approval ' + approvalIndex + '; HTTP status codes ' + failures.join(','));
  } finally {
    await browser?.close(); if (apiServer) await stopTestServer(apiServer);
    await new Promise(done => web.close(done)); await cleanupIntegrationUsers(); await prisma.$disconnect();
  }
});
