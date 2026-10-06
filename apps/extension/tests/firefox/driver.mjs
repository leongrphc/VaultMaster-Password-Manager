import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function startFirefox({ profile } = {}) {
  const work = await mkdtemp(join(tmpdir(), 'vm-firefox-'));
  if (profile) await mkdir(profile, { recursive: true });
  const port = 45000 + Math.floor(Math.random() * 10000);
  const process = spawn(globalThis.process.env.GECKODRIVER || 'geckodriver', ['--port', String(port), '--allow-system-access'], { stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  let session;
  async function request(method, path, body) {
    const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(`WebDriver ${result.value?.error}: ${result.value?.message}`);
    return result.value;
  }
  try {
    await poll(async () => { try { return Boolean(await request('GET', '/status')); } catch { return false; } });
    const result = await request('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'firefox', unhandledPromptBehavior: 'ignore', 'moz:firefoxOptions': {
      ...(globalThis.process.env.FIREFOX_BINARY ? { binary: globalThis.process.env.FIREFOX_BINARY } : {}), args: ['-headless', ...(profile ? ['-profile', profile] : [])],
      prefs: { 'extensions.webextensions.uuids': JSON.stringify({ 'vaultmaster@mozkan.com.tr': 'b63cbb3c-928a-4cb3-a628-1777b745a793' }) }
    } } } });
    session = result.sessionId;
    const command = (method, path, body) => request(method, `/session/${session}${path}`, body);
    await command('POST', '/timeouts', { script: 30000, pageLoad: 30000 });
    return { version: result.capabilities.browserVersion, command,
      script: (script, ...args) => command('POST', '/execute/sync', { script, args }),
      asyncScript: (script, ...args) => command('POST', '/execute/async', { script, args }),
      async goto(url) {
        if (!url.startsWith('moz-extension:')) return command('POST', '/url', { url });
        await command('POST', '/moz/context', { context: 'chrome' });
        try { await command('POST', '/execute/sync', { script: 'window.gBrowser.selectedBrowser.loadURI(Services.io.newURI(arguments[0]), {triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal()});', args: [url] }); }
        finally { await command('POST', '/moz/context', { context: 'content' }); }
        await poll(async () => (await command('GET', '/url')) === url);
      },
      async element(selector) { const element = await command('POST', '/element', { using: 'css selector', value: selector }); return element['element-6066-11e4-a52e-4f735466cecf']; },
      async click(selector) { await command('POST', `/element/${await this.element(selector)}/click`, {}); },
      async fill(selector, text) { const id = await this.element(selector); await command('POST', `/element/${id}/clear`, {}); await command('POST', `/element/${id}/value`, { text }); },
      async close() { try { await command('DELETE', ''); } finally { process.kill(); await rm(work, { recursive: true, force: true }); } }
    };
  } catch (error) { process.kill(); await rm(work, { recursive: true, force: true }); throw error; }
}
export async function poll(check, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error('Firefox condition timed out');
}
