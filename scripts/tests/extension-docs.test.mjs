import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const read = path => readFile(resolve(root, path), 'utf8');
const documents = ['apps/extension/README.md', 'docs/TERMINOLOGY.md',
  'docs/EXTENSION_DOCUMENTATION.md', 'docs/EXTENSION_STORE_PREPARATION.md', 'docs/FIREFOX_SUPPORT.md',
  'docs/ADVANCED_AUTOFILL_SECURITY.md', 'docs/PASSWORD_CHANGE_AUTOFILL.md',
  'docs/IMPORT_CONFLICT_RESOLUTION.md', 'docs/HEALTH_REPORT_PRIVACY.md',
  'docs/SENSITIVE_ACTION_SECURITY.md', 'ReadMe.md', 'DEPLOYMENT.md'];
const github = 'https://github.com/leongrphc/VaultMaster-Password-Manager/blob/feature/p1-6-extension-docs-terminology/';
function reviewCopy(text) {
  assert.doesNotMatch(text, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:ghp_|github_pat_|AKIA)[A-Za-z0-9_]{16,}|\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  assert.doesNotMatch(text, /(?:now available|published|approved) in (?:the )?(?:Chrome Web Store|Edge Add-ons)|automatically updates? from (?:the )?ZIP|mağazada yayınlandı|ZIP otomatik güncellenir/i);
}

test('single glossary defines every core term and guide covers required boundaries', async () => {
  const glossary = await read('docs/TERMINOLOGY.md');
  for (const term of ['vault', 'item', 'login', 'autofill', 'fill', 'save', 'update', 'import', 'export', 'lock', 'unlock']) {
    assert.ok(glossary.includes(`| ${term} |`), term);
  }
  const guide = await read('apps/extension/README.md');
  for (const heading of ['Setup and installation', 'Permissions rationale', 'Trust, origin and form limitations',
    'Password changes, save and update', 'Import and export', 'Health-report privacy', 'Troubleshooting',
    'Release and update guidance', 'Regression and documentation checks']) assert.ok(guide.includes(`## ${heading}`), heading);
  for (const phrase of ['every ancestor', 'closed Shadow DOM', 'even with mismatch confirmation/forced fill',
    'absolute deadline', 'no separate extension options page', 'whole supported payload',
    'public IP and timing', 'cannot recall sent prefixes', 'no atomic', 'two minutes',
    'not store delivery', 'no file import/export UI']) assert.ok(guide.includes(phrase), phrase);
  for (const document of documents.filter(path => path.startsWith('docs/') && path !== 'docs/TERMINOLOGY.md')) {
    assert.ok((await read(document)).includes('(TERMINOLOGY.md)'), document);
  }
});

test('repository documentation links and UI guide destinations exist', async () => {
  for (const path of documents) {
    const source = (await read(path)).replace(/```[\s\S]*?```/g, '');
    for (const match of source.matchAll(/\[[^\]]+\]\(([^\s)]+)\)/g)) {
      const href = match[1];
      if (/^(?:https?:|mailto:)/.test(href)) continue;
      const [target, fragment] = href.split('#');
      const file = target ? resolve(root, dirname(path), decodeURIComponent(target)) : resolve(root, path);
      assert.ok(!relative(root, file).startsWith('..'), `${path}: outside repository`);
      assert.ok((await stat(file)).isFile(), `${path}: ${href}`);
      if (fragment) {
        const headings = [...(await readFile(file, 'utf8')).matchAll(/^#+ (.+)$/gm)]
          .map(match => match[1].toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/ /g, '-'));
        assert.ok(headings.includes(decodeURIComponent(fragment)), `${path}: missing anchor ${href}`);
      }
    }
  }
  for (const path of ['apps/extension/src/popup.html', 'apps/web/src/app/vault/settings/page.tsx']) {
    const source = await read(path);
    assert.ok(source.includes(github + 'apps/extension/README.md'), path);
    const links = [...source.matchAll(/href="(https:\/\/github\.com\/[^\"]+)"/g)];
    for (const [, href] of links) {
      assert.ok(href.startsWith(github), href);
      assert.ok((await stat(resolve(root, href.slice(github.length)))).isFile(), href);
    }
  }
  const settings = await read('apps/web/src/app/vault/settings/page.tsx');
  assert.ok(settings.includes(github + 'docs/TERMINOLOGY.md'));
  assert.ok(settings.includes('/downloads/vaultmaster-extension.zip.sha256'));
  assert.ok(settings.includes('mağaza yayını veya otomatik güncelleme doğrulanmış değildir'));
});

test('key UI labels follow Turkish vocabulary without confusing sign-in and unlock', async () => {
  const popup = await read('apps/extension/src/popup.js');
  const html = await read('apps/extension/src/popup.html');
  assert.ok(popup.includes('Kasa Kilitli')); assert.ok(popup.includes('Kasa Kilidi Açık'));
  assert.ok(popup.includes("isAuthenticated ? 'Kasanın Kilidini Aç' : 'Giriş Yap'"));
  assert.ok(html.includes('Kasayı Kilitle')); assert.ok(html.includes('otomatik doldurma'));
  for (const source of [popup, html]) assert.doesNotMatch(source, /Vault (?:açık|kilitli)|Akıllı Autofill|hızlı autofill|Domain eşleşmesi|Mail önerisi/);
  const save = await read('apps/extension/src/content.js');
  assert.ok(save.includes("'Şifreyi Güncelle' : 'Kaydet'"));
  assert.ok(save.includes('Yeni giriş bilgisi kaydet?'));
  assert.ok((await read('apps/web/src/app/page.tsx')).includes('requires2FA ? "Doğrula" : "Giriş Yap"'));
  for (const path of ['apps/web/src/components/vault/ImportReviewPanel.tsx', 'apps/web/src/components/vault/FullBackupPanel.tsx', 'apps/web/src/app/vault/health/page.tsx']) {
    assert.doesNotMatch(await read(path), /\bKayıt |\bkayıt /, path);
  }
  const manifest = JSON.parse(await read('apps/extension/src/manifest.json'));
  assert.equal(manifest.options_ui, undefined); assert.equal(manifest.options_page, undefined);
});

test('documentation/copy safety gate rejects secret markers and affirmative publication claims', async () => {
  for (const path of [...documents, 'apps/extension/src/popup.html', 'apps/web/src/app/vault/settings/page.tsx']) reviewCopy(await read(path));
  for (const unsafe of ['-----BEGIN PRIVATE KEY-----', 'ghp_' + 'x'.repeat(20),
    'Now available in the Chrome Web Store', 'ZIP otomatik güncellenir']) assert.throws(() => reviewCopy(unsafe));
  reviewCopy('No store upload, publication or automatic store update is claimed. The manifest key is public.');
});
