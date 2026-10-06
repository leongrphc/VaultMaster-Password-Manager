import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { packageExtension } from '../../../../scripts/package-extension.mjs';
import { verifyExtension } from '../../../../scripts/verify-extension.mjs';
import { validateManifest } from '../../../../scripts/extension-release-policy.mjs';

test('Firefox MV3 identity, consent, least privilege and reproducible package', async () => {
  const work = await mkdtemp(join(tmpdir(), 'vm-firefox-package-'));
  try {
    const first = join(work, 'first.zip'), second = join(work, 'second.zip');
    assert.equal(await packageExtension(first, 'firefox'), await packageExtension(second, 'firefox'));
    assert.deepEqual(await readFile(first), await readFile(second));
    assert.equal(verifyExtension(await readFile(first)).extensionId, 'vaultmaster@mozkan.com.tr');
    const manifest = JSON.parse(await readFile('apps/extension/dist-firefox/manifest.json'));
    validateManifest(manifest);
    for (const patch of [{ key: 'chromium' }, { minimum_chrome_version: '127' },
      { background: { service_worker: 'background.js', type: 'module' } },
      { permissions: [...manifest.permissions, 'tabs'] }, { host_permissions: ['<all_urls>'] },
      { web_accessible_resources: [{ resources: ['*.js'], matches: ['<all_urls>'] }] },
      { browser_specific_settings: { gecko: { ...manifest.browser_specific_settings.gecko, strict_min_version: '140.0' } } },
      { browser_specific_settings: { gecko: { ...manifest.browser_specific_settings.gecko, data_collection_permissions: { required: ['none'] } } } }]) {
      assert.throws(() => validateManifest({ ...manifest, ...patch }));
    }
  } finally { await rm(work, { recursive: true, force: true }); }
});
