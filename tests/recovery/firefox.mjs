import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { createVaultKey, deriveMasterKey, generateAuthHash, wrapVaultKey, encryptJSON, decryptJSON } from '../../packages/crypto/dist/index.js';
import { startFirefox, poll } from '../../apps/extension/tests/firefox/driver.mjs';
if (!process.env.VAULTMASTER_TEST_DATABASE_URL) throw new Error('Explicit disposable test database required');
test('Stock Firefox web sharing, emergency approvals and receipt-bound import conflicts with real API/PostgreSQL', { timeout: 180000 }, async t => {
  const root = resolve(new URL('../../apps/web/out', import.meta.url).pathname);
  const csp = (await readFile(join(root, '_headers'), 'utf8')).match(/Content-Security-Policy: ([^\r\n]+)/)?.[1];
  assert.ok(csp);
  let upstream, a, b, apiServer;
  let step = 'start';
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
    a = await startFirefox(); b = await startFirefox();
    assert.ok(parseInt(a.version) >= 153); t.diagnostic(`Firefox ${a.version}`);
    // Find elements through visible UI text, then use actual WebDriver clicks/keys.
    async function locate(d, kind, text) {
      let found;
      await poll(async () => {
        found = await d.script(`const [kind,text]=arguments;
          document.querySelectorAll('[data-firefox-fixture]').forEach(n=>n.removeAttribute('data-firefox-fixture'));
          let node;
          if(kind==='label') { node=[...document.querySelectorAll('input,textarea,select')].find(n=>n.getAttribute('aria-label')===text || [...(n.labels||[])].some(l=>l.textContent.trim()===text)); }
          else { node=[...document.querySelectorAll(kind)].find(n=>(n.textContent.trim()===text || n.getAttribute('title')===text || n.getAttribute('aria-label')===text) && n.getBoundingClientRect().width>0); }
          if(!node) return false; node.setAttribute('data-firefox-fixture','selected');return true;`, kind, text);
        return found;
      });
      return '[data-firefox-fixture="selected"]';
    }
    async function click(d, kind, text) { step = 'click ' + text; const selector = await locate(d, kind, text); await d.click(selector); }
    async function fill(d, text, value) { step = 'fill ' + text; const selector=await locate(d,'label',text); await d.fill(selector,value); await d.script('document.querySelectorAll("[data-firefox-fixture]").forEach(n=>n.removeAttribute("data-firefox-fixture"))'); }
    const has = (d, text) => d.script('return document.body.innerText.includes(arguments[0]);', text);
    async function dSelect(d, value) {
      step = 'select access type';
      await d.click('[aria-label="Erişim türü"] option[value="' + value + '"]');
    }
    async function login(d, email) {
      await prisma.abuseBucket.deleteMany(); await d.goto(origin); await fill(d,'E-posta',email); await fill(d,'Ana Şifre',password);
      await click(d,'button','Giriş Yap'); await click(d,'a','Ayarlar'); await click(d,'button','Paylaşım');
    }
    async function approve(d, text, confirm = false, count = 1) {
      await prisma.abuseBucket.deleteMany(); await click(d,'button',text);
      if(confirm) await d.command('POST','/alert/accept',{});
      for (let i = 0; i < count; i++) {
        await poll(async () => await d.script('return !!document.querySelector("[role=dialog]")'));
        await fill(d,'Ana şifre',password); await click(d,'button','Doğrula ve devam et');
        await poll(async () => !(await d.script('return !!document.querySelector("[role=dialog]")')));
      }
      await poll(async () => await has(d,'İşlem tamamlandı.'));
    }
    await login(a,owner.payload.email); await login(b,recipient.payload.email);
    await approve(a,'Cihaz Kişi Kartı Oluştur'); await approve(b,'Cihaz Kişi Kartı Oluştur');
    const card = d=>d.script('return document.querySelector(arguments[0]).value', '[aria-label="Kişi kartım"]');
    const senderCard=await card(a), recipientCard=await card(b);
    await fill(a,'Doğrulanmış kişi kartı',recipientCard);
    await click(a,'label','Kişi kartını bağımsız güvenilir kanalda karşılaştırdım.');
    await click(a,'label',payload.title);
    assert.equal(await prisma.exchangeGrant.count(),0);
    await click(a,'button','Daveti Onayla ve Gönder'); await a.command('POST','/alert/dismiss',{});
    assert.equal(await prisma.exchangeGrant.count(),0);
    await approve(a,'Daveti Onayla ve Gönder',true);
    assert.equal((await prisma.exchangeGrant.findFirstOrThrow()).status,'pending');
    await click(b,'button','Davetleri Yenile'); await fill(b,'Doğrulanmış kişi kartı',senderCard);
    await click(b,'label','Kişi kartını bağımsız güvenilir kanalda karşılaştırdım.');
    await approve(b,'Daveti Kabul Et',true);
    await approve(b,'Şifreyi Çöz ve İçe Aktarmayı İncele');
    assert.equal(await prisma.vaultItem.count({where:{userId:recipient.data.user.id}}),0);
    await click(b,'button','İncelemeyi Onayla ve İçe Aktar');
    await poll(async () => (await prisma.vaultItem.count({where:{userId:recipient.data.user.id}}))===1);
    const item=await prisma.vaultItem.findFirstOrThrow({where:{userId:recipient.data.user.id}});
    assert.equal((await decryptJSON(item.encryptedData,item.iv,recipientKey)).password,payload.password);
    await approve(b,'Şifreyi Çöz ve İçe Aktarmayı İncele');
    await poll(async () => await has(b,'Öğe 1: Aynı öğe — atlanacak')); await click(b,'button','İptal');
    assert.equal(await prisma.vaultItem.count({where:{userId:recipient.data.user.id}}),1);
    await click(a,'button','Davetleri Yenile');
    await poll(async () => await has(a,'Paylaşım · accepted'));
    await approve(a,'Erişimi İptal Et',true);
    await click(b,'button','Davetleri Yenile');
    await dSelect(a, 'emergency');
    await fill(a,'Bekleme saati','1');
    await approve(a,'Daveti Onayla ve Gönder',true);
    await click(b,'button','Davetleri Yenile');
    await approve(b,'Daveti Kabul Et',true);
    await approve(b,'Acil Erişim Talep Et',true);
    const emergency = await prisma.exchangeGrant.findFirstOrThrow({where:{kind:'emergency'}});
    assert.equal(emergency.envelope,null);
    await prisma.exchangeGrant.update({where:{id:emergency.id},data:{requestedAt:new Date(Date.now()-3600001)}});
    const note={type:'secure_note',title:'Emergency synthetic note',content:'synthetic-emergency-only-secret'};
    const noteData=await encryptJSON(note,sourceKey);
    assert.equal((await request(upstream,'/api/vault',{method:'POST',headers:authHeaders(owner.accessToken),body:{encryptedData:noteData.ciphertext,iv:noteData.iv,favorite:false}})).status,201);
    await click(a,'button','Davetleri Yenile');
    await approve(a,'Kasa Görüntüsünü Onayla ve Paylaş',true,2);
    await click(b,'button','Davetleri Yenile');
    await approve(b,'Şifreyi Çöz ve İçe Aktarmayı İncele');
    await poll(async () => await has(b,'2 öğe incelendi'));
    await click(b,'button','İncelemeyi Onayla ve İçe Aktar');
    await poll(async () => (await prisma.vaultItem.count({where:{userId:recipient.data.user.id}}))===2);
    const restored=await prisma.vaultItem.findMany({where:{userId:recipient.data.user.id}});
    const plaintexts=await Promise.all(restored.map(item=>decryptJSON(item.encryptedData,item.iv,recipientKey)));
    assert.ok(plaintexts.some(item=>item.content===note.content));
    await prisma.exchangeGrant.update({where:{id:emergency.id},data:{expiresAt:new Date(0)}});
    await click(b,'button','Davetleri Yenile');
    await poll(async () => !(await has(b,'Şifreyi Çöz ve İçe Aktarmayı İncele')));
    await click(b,'button','Kasayı Kilitle');
    await fill(b,'Ana Şifre',password); await click(b,'button','Ana şifre ile kilidi aç');
    await click(b,'button','Paylaşım'); await click(b,'button','Kişi Kartımı Göster');
    t.diagnostic('cancelled send, separate send/accept/decrypt approvals, explicit import, duplicate review, revoke, owner-approved emergency snapshot, expiry and lock/unlock passed');
  } catch (error) {
    const line=String(error.stack).match(/firefox\.mjs:(\d+):\d+/)?.[1] || 'unknown';
    const reason = String(error.message).match(/^WebDriver ([a-z ]+):/)?.[1] || (error.message === 'Firefox condition timed out' ? 'condition timed out' : 'assertion or scenario failure');
    throw new Error('Synthetic Firefox web check failed at scenario line '+line+'; '+step+'; '+reason);
  } finally {
    await a?.close(); await b?.close(); if(apiServer) await stopTestServer(apiServer);
    await new Promise(done=>web.close(done)); await cleanupIntegrationUsers(); await prisma.$disconnect();
  }
});
