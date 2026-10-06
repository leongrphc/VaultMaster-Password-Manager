import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startFirefox, poll } from './driver.mjs';
import { deriveMasterKey, generateAuthHash, createVaultKey, wrapVaultKey, encryptJSON, decryptJSON } from '../../../../packages/crypto/dist/index.js';
import { verifyRegistrationResponse, verifyAuthenticationResponse } from '../../../api/node_modules/@simplewebauthn/server/esm/index.js';

// Actual release Firefox, installed via Marionette. No Playwright-patched Gecko,
// mocked WebExtension APIs, production accounts, secret dumps or screenshots.
test('Firefox install, session, document trust, fill, change approval, passkeys, sharing, navigation and update', { timeout: 180000 }, async t => {
  const work = await mkdtemp(join(tmpdir(), 'vm-firefox-browser-'));
  const extension = join(work, 'extension');
  const email = 'firefox@example.test', password = 'Synthetic-firefox-master-2026!';
  const wrapping = await deriveMasterKey(password, email), authHash = await generateAuthHash(wrapping, password);
  const key = await createVaultKey(), envelope = { ...await wrapVaultKey(key, wrapping), version: 1 };
  let items = [], writes = 0, requireMfa = true;
  let origin;
  const form = '<form action="/success" method="post"><input id="user" autocomplete="username" value="synthetic"><input id="current" type="password" autocomplete="current-password"><button id="submit">Submit</button></form>';
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (!path.startsWith('/api')) {
      res.setHeader('content-type', 'text/html');
      res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; object-src 'none'");
      const change = form.replace('<button', '<input id="next" type="password" autocomplete="new-password"><input id="confirm" type="password" autocomplete="new-password"><button');
      res.end(path === '/change' ? change : path === '/frame' ? '<iframe src="/login"></iframe>' : path === '/foreign' ? `<iframe src="http://localhost:${server.address().port}/login"></iframe>` : path === '/shadow' ? '<div id="host"></div>' : path === '/rp' ? '<h1>Synthetic RP</h1>' : form); return;
    }
    let raw = ''; for await (const chunk of req) raw += chunk;
    assert.ok(!raw.includes(password));
    const body = raw ? JSON.parse(raw) : {};
    const reply = (data, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ success: status < 400, data, error: status >= 400 ? 'Synthetic rejection' : undefined })); };
    if (path === '/api/auth/login') {
      if (body.authHash !== authHash) return reply(null, 401);
      if (requireMfa && body.code !== '123456') return reply({ requires2FA: true });
      return reply({ user: { id: 'synthetic', email }, deviceId: 'device', tokens: { accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh' }, vaultKeyEnvelope: envelope });
    }
    if (path === '/api/auth/unlock') return body.authHash === authHash ? reply({ vaultKeyEnvelope: envelope }) : reply(null, 403);
    if (path === '/api/auth/me') return reply({ id: 'synthetic', email });
    if (path === '/api/vault' && req.method === 'GET') return reply(items);
    if (path.startsWith('/api/vault') && ['POST', 'PUT'].includes(req.method)) {
      assert.deepEqual(Object.keys(body).sort(), ['encryptedData', 'folderId', 'iv']);
      writes++;
      if (req.method === 'PUT') items = items.map(item => item.id === path.split('/').at(-1) ? { ...item, ...body } : item);
      else items.push({ id: crypto.randomUUID(), ...body });
      return reply({ id: items.at(-1).id });
    }
    return reply(null, 404);
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${server.address().port}`;
  const encrypted = await encryptJSON({ type: 'login', title: 'Synthetic', username: 'synthetic', password: 'synthetic-site-password', url: origin }, key);
  items.push({ id: 'login', encryptedData: encrypted.ciphertext, iv: encrypted.iv, folderId: null });
  let d;
  try {
    await cp(resolve('apps/extension/dist-firefox'), extension, { recursive: true });
    await writeFile(join(extension, 'config.js'), `export const API_URL = ${JSON.stringify(origin + '/api')};\n`);
    const manifest = JSON.parse(await readFile(join(extension, 'manifest.json')));
    manifest.content_security_policy.extension_pages = `script-src 'self'; object-src 'none'; connect-src ${origin}; base-uri 'none'; frame-src 'none'`;
    await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
    d = await startFirefox({ profile: join(work, 'profile') }); assert.ok(parseInt(d.version) >= 153); t.diagnostic(`Firefox ${d.version}`);
    assert.equal(await d.command('POST', '/moz/addon/install', { path: extension, temporary: true }), 'vaultmaster@mozkan.com.tr');
    await d.command('POST', '/moz/context', { context: 'chrome' });
    await d.asyncScript(`const done=arguments[arguments.length-1]; const {ExtensionPermissions}=ChromeUtils.importESModule('resource://gre/modules/ExtensionPermissions.sys.mjs'); ExtensionPermissions.add('vaultmaster@mozkan.com.tr', {permissions:[], origins:['http://*/*','https://*/*']}).then(()=>done(true)).catch(e=>done(e.message));`);
    await d.command('POST', '/moz/context', { context: 'content' });
    const popupUrl = 'moz-extension://b63cbb3c-928a-4cb3-a628-1777b745a793/popup.html';
    await d.goto(popupUrl);
    const popupHandle = await d.command('GET', '/window');
    const message = payload => d.asyncScript('browser.runtime.sendMessage(arguments[0]).then(arguments[arguments.length-1]);', payload);
    const status = async value => poll(async () => (await d.script('return !document.querySelector("#session-submit").disabled && document.querySelector("#vault-status").textContent')) === value);
    await status('Giriş yapılmadı');
    await d.fill('#email', email); await d.fill('#master-password', password); await d.click('#session-submit');
    await poll(async () => !(await d.script('return document.querySelector("#code-label").hidden')));
    await d.fill('#two-factor-code', '123456'); await d.fill('#master-password', password); await d.click('#session-submit');
    await status('Kasa Kilidi Açık ✓'); requireMfa = false;
    assert.equal(await d.script('return document.querySelector("#master-password").value'), '');
    // Firefox's session area cannot be made available to content scripts.
    assert.equal(await d.script('return typeof browser.storage.session.setAccessLevel'), 'undefined');
    await d.click('#lock-button'); await status('Kasa Kilitli 🔒');
    await d.fill('#master-password', 'wrong'); await d.click('#session-submit'); await status('Kasa Kilitli 🔒');
    await d.fill('#master-password', password); await d.click('#session-submit'); await status('Kasa Kilidi Açık ✓');
    t.diagnostic('install, MFA, lock and online unlock passed');
    const pageHandle = (await d.command('POST', '/window/new', { type: 'tab' })).handle;
    const select = handle => d.command('POST', '/window', { handle });
    await select(pageHandle); await d.goto(origin + '/login');
    const tabId = await (async () => { await select(popupHandle); return d.asyncScript('const done=arguments[arguments.length-1]; browser.tabs.query({}).then(t=>done(t.find(x=>x.url?.startsWith("http:"))?.id || {missing:true,tabs:t.map(x=>({id:x.id,url:x.url}))})).catch(e=>done({error:e.message}));', origin + '/login'); })();
    assert.equal(typeof tabId, "number", JSON.stringify(tabId));
    async function popup() {
      await select(popupHandle);
      // Keep the target tab active, as it is under the real toolbar popup.
      await d.asyncScript('browser.tabs.update(arguments[0],{active:true}).then(arguments[arguments.length-1]);', tabId);
      await d.script('document.querySelector("#refresh-button").click()');
      await poll(async () => !(await d.script('return document.querySelector("#refresh-button").disabled')));
    }
    async function targets() { await popup(); return (await message({ type: 'LIST_AUTOFILL_TARGETS', tabId })).payload.targets; }
    async function fill() { await popup(); await poll(async () => await d.script('return !!document.querySelector(".suggestion-item")')); await d.click('.suggestion-item'); }
    await fill(); await select(pageHandle);
    await poll(async () => (await d.script('return document.querySelector("#current").value')) === 'synthetic-site-password');
    // Session storage remains unavailable in the isolated content world.
    assert.equal(await d.script('return typeof window.browser'), 'undefined');
    await d.goto(origin + '/frame');
    await poll(async () => (await targets()).some(target => target.frameId !== 0 && target.supported));
    const same = (await targets()).find(target => target.frameId !== 0); assert.ok(same.documentId);
    assert.equal((await message({ type: 'FILL_AUTOFILL_TARGET', tabId, documentId: same.documentId,
      formToken: same.formToken, itemId: 'login' })).ok, true);
    await select(pageHandle);
    await poll(async () => (await d.script('return document.querySelector("iframe").contentDocument.querySelector("#current").value')) === 'synthetic-site-password');
    await select(pageHandle); await d.goto(origin + '/foreign');
    await poll(async () => (await targets()).some(target => target.frameId !== 0 && !target.supported));
    await select(pageHandle); await d.goto(origin + '/shadow');
    await d.script('document.querySelector("#host").attachShadow({mode:"open"}).innerHTML=arguments[0];', form);
    await d.script('document.querySelector("#host").shadowRoot.querySelector("#user").focus()');
    await fill(); await select(pageHandle);
    await poll(async () => (await d.script('return document.querySelector("#host").shadowRoot.querySelector("#current").value')) === 'synthetic-site-password');
    await d.goto(origin + '/change'); await fill(); await select(pageHandle);
    assert.equal(await d.script('return document.querySelector("#next").value'), '');
    await popup(); await d.click('[data-action="generate-password"]'); await select(pageHandle);
    await poll(async () => (await d.script('return document.querySelector("#next").value.length')) === 24);
    const next = await d.script('return document.querySelector("#next").value');
    assert.equal(writes, 0); await d.click('#submit');
    await poll(async () => await d.script('return !!document.querySelector("[data-action=save]")'));
    assert.equal(writes, 0); await d.click('[data-action="save"]');
    await poll(async () => writes === 1);
    assert.equal((await decryptJSON(items[0].encryptedData, items[0].iv, key)).password, next);
    t.diagnostic('top-level/iframe/Shadow DOM fill, foreign-frame denial and password-change approval passed');
    // Exact document IDs invalidate a selection even at the same URL.
    const old = (await targets())[0]; await select(pageHandle); await d.goto(origin + '/success'); await popup();
    assert.equal((await message({ type: 'FILL_AUTOFILL_TARGET', tabId, documentId: old.documentId, formToken: old.formToken, itemId: 'login' })).ok, false);
    await select(pageHandle); await d.script('history.pushState({},"","/route");');
    await poll(async () => (await targets())[0]?.url.endsWith('/route'));
    t.diagnostic('same-URL document replacement and SPA navigation passed');
    await select(pageHandle); await d.goto(origin + '/rp');
    const challenge = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
    async function start(operation, unsupported = false) {
      await select(pageHandle);
      await d.script(`const challenge=Uint8Array.from(atob(arguments[1].replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
        const publicKey=arguments[0]==='create'?{challenge,rp:{id:'127.0.0.1',name:'Synthetic'},user:{id:new Uint8Array([1,2,3]),name:'synthetic',displayName:'Synthetic'},pubKeyCredParams:[{type:'public-key',alg:-7}],attestation:'none',authenticatorSelection:{userVerification:arguments[2]?'required':'preferred'}}:{challenge,rpId:'127.0.0.1',userVerification:'preferred'};
        window.result=null;window.failure=null;window.cancel=new AbortController();navigator.credentials[arguments[0]]({publicKey,signal:window.cancel.signal}).then(c=>window.result=c.toJSON()).catch(e=>window.failure=e.name);`, operation, challenge, unsupported);
    }
    await start('create'); await poll(async () => await d.script('return !!document.querySelector("#vaultmaster-passkey-pending")'));
    await popup(); await poll(async () => await d.script('return !!document.querySelector("[data-action=approve-passkey]")'));
    await d.script('document.querySelector("[data-action=approve-passkey]").click()'); assert.equal(writes, 1);
    await d.click('[data-action="approve-passkey"]'); await select(pageHandle);
    await poll(async () => Boolean(await d.script('return window.result')));
    const registration = await d.script('return window.result');
    const verified = await verifyRegistrationResponse({ response: registration, expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: '127.0.0.1', requireUserVerification: false });
    assert.equal(verified.verified, true);
    await start('get'); await popup(); await poll(async () => await d.script('return !!document.querySelector("[data-action=approve-passkey]")')); await d.click('[data-action="approve-passkey"]');
    await select(pageHandle); await poll(async () => Boolean(await d.script('return window.result')));
    assert.equal((await verifyAuthenticationResponse({ response: await d.script('return window.result'), expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: '127.0.0.1', credential: verified.registrationInfo.credential, requireUserVerification: false })).verified, true);
    await start('get'); await popup(); await d.click('[data-action="cancel-passkey"]'); await select(pageHandle); await poll(async () => (await d.script('return window.failure')) === 'NotAllowedError');
    await start('create', true); assert.equal(await d.script('return !!document.querySelector("#vaultmaster-passkey-pending")'), false); await d.script('window.cancel.abort()');
    t.diagnostic('verified ES256 registration/assertion, protected click, cancel and native required-UV path passed');
    await popup(); await d.click('#open-sharing-button');
    await poll(async () => { await select(popupHandle); return await d.asyncScript('browser.tabs.query({}).then(t=>arguments[arguments.length-1](t.some(x=>x.url?.endsWith("/vault/settings/?tab=sharing"))));'); });
    assert.equal(writes, 2);
    assert.equal((await message({ type: 'NATIVE_STATUS' })).payload.isLocked, false);
    await d.asyncScript('browser.storage.local.set({firefoxUpdateFixture:"synthetic-preference"}).then(arguments[arguments.length-1]);');
    // Temporary add-on replacement exercises stable ID and session invalidation;
    // signed AMO delivery remains an external release prerequisite.
    manifest.version = '1.3.1'; await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
    assert.equal(await d.command('POST', '/moz/addon/install', { path: extension, temporary: true }), 'vaultmaster@mozkan.com.tr');
    await select(pageHandle);
    const updatedHandle = (await d.command('POST', '/window/new', { type: 'tab' })).handle;
    await select(updatedHandle); await d.goto(popupUrl); await status('Giriş yapılmadı');
    assert.equal(await d.asyncScript('browser.storage.local.get("firefoxUpdateFixture").then(x=>arguments[arguments.length-1](x.firefoxUpdateFixture));'), 'synthetic-preference');
    t.diagnostic('sharing shortcut and same-ID version replacement preserve local data and invalidate session');
    await d.close(); d = await startFirefox({ profile: join(work, 'profile') });
    assert.equal(await d.command('POST', '/moz/addon/install', { path: extension, temporary: true }), 'vaultmaster@mozkan.com.tr');
    await d.goto(popupUrl); await status('Giriş yapılmadı');
    await d.fill('#email', email); await d.fill('#master-password', password); await d.click('#session-submit'); await status('Kasa Kilidi Açık ✓');
    t.diagnostic('same-profile Firefox restart reinstalls temporary addon and requires fresh online sign-in');
  } finally { await d?.close(); await new Promise(done => server.close(done)); await rm(work, { recursive: true, force: true }); }
});
