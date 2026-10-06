import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, rm, mkdtemp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { packageExtension } from '../../../scripts/package-extension.mjs';
import { verifyExtension } from '../../../scripts/verify-extension.mjs';
import { releaseFiles, extensionId, validateManifest, validateFiles, sha256 } from '../../../scripts/extension-release-policy.mjs';
const root = resolve(import.meta.dirname, '..');
const source = JSON.parse(await readFile(join(root, 'src/manifest.json')));
test('release manifest pins identity, version, minimal permissions and HTTP(S) policy', async () => {
  validateManifest(source);
  assert.equal(extensionId(source.key), 'cajnckjhhpbgephllmoaceolbifmnkoa');
  assert.equal(source.version, JSON.parse(await readFile(join(root, 'package.json'))).version);
  for (const patch of [{ key: '' }, { permissions: [...source.permissions, 'tabs'] },
    { permissions: [...source.permissions, 'activeTab'] }, { host_permissions: ['<all_urls>'] },
    { update_url: 'https://example.test/updates' }, { externally_connectable: { matches: ['*://*/*'] } },
    { content_scripts: [{ ...source.content_scripts[0], match_origin_as_fallback: true }] }]) {
    assert.throws(() => validateManifest({ ...source, ...patch }));
  }
});
test('unreviewed source blocks packaging; clean rebuilds are reproducible, inventoried and exclude local artifacts', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'vaultmaster-release-'));
  const artifact = join(root, 'src/p1-5-local-fixture.map');
  try {
    await writeFile(artifact, 'test local artifact, must never ship');
    // P2-4 requires a new review even for added source files. No automatic pin refresh.
    await assert.rejects(packageExtension(join(temp, 'blocked.zip')));
    await rm(artifact);
    const first = join(temp, 'first.zip'), second = join(temp, 'second.zip');
    assert.equal(await packageExtension(first), await packageExtension(second));
    const zip = await readFile(first);
    assert.deepEqual(zip, await readFile(second));
    assert.ok((await readFile(first + '.sha256', 'utf8')).startsWith(sha256(zip)));
    const inventory = verifyExtension(zip);
    assert.deepEqual(Object.keys(inventory.files), releaseFiles);
    assert.equal(inventory.version, source.version);
    assert.equal(inventory.extensionId, extensionId(source.key));
    const files = new Map(await Promise.all(releaseFiles.map(async name => [name, await readFile(join(root, 'dist', name))])));
    const manifest = JSON.parse(files.get('manifest.json'));
    files.set('manifest.json', Buffer.from(JSON.stringify({ ...manifest, content_security_policy: { extension_pages: "script-src 'self' 'unsafe-eval'" } })));
    assert.throws(() => validateFiles(files));
    files.set('manifest.json', Buffer.from(JSON.stringify(manifest)));
    files.set('.env', Buffer.from('secret')); assert.throws(() => validateFiles(files)); files.delete('.env');
    files.set('popup.js', Buffer.from('-----BEGIN PRIVATE KEY-----')); assert.throws(() => validateFiles(files));
    files.set('popup.js', Buffer.from('//# sourceMappingURL=popup.js.map')); assert.throws(() => validateFiles(files));
    const corrupt = Buffer.from(zip); corrupt[50] ^= 1; assert.throws(() => verifyExtension(corrupt));
  } finally { await rm(artifact, { force: true }); await rm(temp, { recursive: true, force: true }); }
});
