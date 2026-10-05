import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { chromium, expect } from '@playwright/test';

// Run from the repository root. The real MV3 extension communicates with a mocked
// unlocked vault page; no production account, database or secret is required.
test('real extension rechecks locks across fills and full-page two-step navigation', { timeout: 60000 }, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'vaultmaster-browser-'));
  const extension = join(temp, 'extension');
  let context;
  try {
    await cp(resolve('apps/extension/src'), extension, { recursive: true });
    context = await chromium.launchPersistentContext(join(temp, 'profile'), {
      channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    context.setDefaultTimeout(10000);
    const credential = { itemId: 'fixture-login', title: 'Fixture', username: 'octo', password: 'fixture-secret', hasTotp: false };
    await context.route('http://localhost:3000/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><script>
      window.locked = false;
      window.domainValid = true;
      window.credentialRequests = 0;
      window.saved = [];
      const credential = ${JSON.stringify(credential)};
      window.addEventListener('message', event => {
        const data = event.data;
        if (event.source !== window || data?.source !== 'vaultmaster-extension') return;
        let payload = { status: 'ready', suggestions: [], isLocked: window.locked };
        if (data.type === 'VM_LIST_LOGIN_SUGGESTIONS_REQUEST') payload.suggestions = [{...credential, password: undefined}];
        if (data.type === 'VM_GET_LOGIN_CREDENTIAL_REQUEST') {
          window.credentialRequests++;
          payload = window.locked ? { status: 'locked' } : (!window.domainValid && !data.forceFill ? { status: 'domain_mismatch' } : { status: 'ready', credential });
        }
        if (data.type === 'VM_SAVE_LOGIN_REQUEST') {
          if (window.locked) payload = { status: 'locked' };
          else { window.saved.push(data.credential); payload = { status: 'created' }; }
        }
        // Exercise the legacy response names used by the deployed web bridge.
        const type = data.type === 'VM_SAVE_LOGIN_REQUEST' ? 'VM_SAVE_LOGIN_RESPONSE' : data.type + '_RESPONSE';
        window.postMessage({ source: 'vaultmaster-web', type, requestId: data.requestId, payload }, location.origin);
      });
    </script>` }));
    await context.route('https://example.test/**', route => {
      const step = new URL(route.request().url()).pathname;
      if (step === '/success') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><p>Signed in</p>' });
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><form action="/success" method="post">
        ${step !== '/password' ? '<input id="email" autocomplete="username" type="email">' : ''}
        ${step !== '/identifier' ? '<input id="password" autocomplete="current-password" type="password">' : ''}
        <button id="submit" type="submit">Sign in</button></form>` });
    });
    const vault = await context.newPage();
    await vault.goto('http://localhost:3000/vault');
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const target = await context.newPage();
    async function fill() {
      return worker.evaluate(async () => {
        const tabs = await chrome.tabs.query({ url: 'https://example.test/*' });
        return chrome.tabs.sendMessage(tabs[0].id, { type: 'FILL_LOGIN_CREDENTIAL', itemId: 'fixture-login' });
      });
    }
    await target.goto('https://example.test/login');
    await target.locator('#email').focus();
    await expect(target.locator('[data-action="fill"]')).toBeVisible();
    await target.locator('[data-action="fill"]').evaluate(button => button.click());
    assert.equal(await vault.evaluate(() => window.credentialRequests), 0);
    await expect(target.locator('#password')).toHaveValue('');
    await target.locator('[data-action="fill"]').click();
    await expect(target.locator('#password')).toHaveValue(credential.password);
    await target.locator('#password').fill('');
    await vault.evaluate(() => window.locked = true);
    assert.equal((await fill()).ok, false);
    await expect(target.locator('#password')).toHaveValue('');
    assert.ok(await vault.evaluate(() => window.credentialRequests >= 2));

    await vault.evaluate(() => { window.locked = false; window.domainValid = false; });
    await target.goto('https://example.test/login');
    await target.locator('#email').focus();
    await target.locator('[data-action="fill"]').click();
    await expect(target.locator('[data-action="force-fill"]')).toBeVisible();
    await expect(target.locator('#password')).toHaveValue('');
    await target.locator('[data-action="force-fill"]').evaluate(button => button.click());
    await expect(target.locator('#password')).toHaveValue('');
    await target.locator('[data-action="force-fill"]').click();
    await expect(target.locator('#password')).toHaveValue(credential.password);
    await vault.evaluate(() => window.domainValid = true);
    await target.goto('https://example.test/identifier');
    assert.equal((await fill()).ok, true);
    await expect(target.locator('#email')).toHaveValue(credential.username);
    const pending = await worker.evaluate(async () => (await chrome.storage.session.get('vaultmasterPendingAutofill')).vaultmasterPendingAutofill);
    assert.equal(JSON.stringify(pending).includes(credential.password), false);
    await target.goto('https://example.test/password');
    await expect(target.locator('#password')).toHaveValue(credential.password);

    await target.goto('https://example.test/identifier');
    assert.equal((await fill()).ok, true);
    await vault.evaluate(() => window.locked = true);
    await target.goto('https://example.test/password');
    await expect.poll(() => worker.evaluate(async () => Object.keys((await chrome.storage.session.get('vaultmasterPendingAutofill')).vaultmasterPendingAutofill || {}).length)).toBe(0);
    await expect(target.locator('#password')).toHaveValue('');

    await target.goto('https://example.test/login');
    await target.locator('#email').fill('new-user@example.test');
    await target.locator('#password').fill('new-login-secret');
    await target.evaluate(() => document.querySelector('form').addEventListener('submit', () => {
      document.querySelector('#password').value = 'changed-after-submit';
    }));
    await target.locator('#submit').click();
    await target.waitForURL('https://example.test/success');
    await expect(target.locator('[data-action="save"]')).toBeVisible();
    assert.equal(await vault.evaluate(() => window.saved.length), 0);
    const drafts = await worker.evaluate(async () => (await chrome.storage.session.get('vaultmasterPendingSaves')).vaultmasterPendingSaves);
    assert.equal(JSON.stringify(drafts).includes('new-login-secret'), false);
    await target.locator('[data-action="save"]').evaluate(button => button.click());
    assert.equal(await vault.evaluate(() => window.saved.length), 0);
    await target.locator('[data-action="save"]').click();
    await expect(target.locator('[data-save-error]')).toBeVisible();
    await expect(target.locator('[data-action="save"]')).toBeEnabled();
    await vault.evaluate(() => window.locked = false);
    await target.locator('[data-action="save"]').click();
    await expect.poll(() => vault.evaluate(() => window.saved.length)).toBe(1);
    assert.equal(await vault.evaluate(() => window.saved[0].password), 'new-login-secret');
    await expect.poll(() => worker.evaluate(async () => Object.keys((await chrome.storage.session.get('vaultmasterPendingSaves')).vaultmasterPendingSaves || {}).length)).toBe(0);
  } finally {
    await context?.close();
    await rm(temp, { recursive: true, force: true });
  }
});
