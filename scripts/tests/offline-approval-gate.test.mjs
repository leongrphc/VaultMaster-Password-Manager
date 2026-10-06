import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkOfflineDisabled, requireOfflineApproval, fingerprint, REVIEWED_PATHS } from '../offline-approval-gate.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const recordPath = 'docs/offline-unlock-fill-gate.json';
const modelPath = 'docs/OFFLINE_UNLOCK_FILL_THREAT_MODEL.md';
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'vm-offline-gate-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const record = JSON.parse(readFileSync(join(repo, recordPath)));
  const files = [];
  for (const path of REVIEWED_PATHS) {
    const file = /\.(mjs|ts|json|yaml)$/.test(path) ? path : `${path}/fixture.js`;
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), 'synthetic reviewed source\n');
    record.reviewedSources[path] = fingerprint(root, path);
    files.push(file);
  }
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, modelPath), readFileSync(join(repo, modelPath)));
  const save = () => writeFileSync(join(root, recordPath), JSON.stringify(record));
  save();
  return { root, record, files, save };
}

test('real checkout verifies disabled state but approval always fails', () => {
  assert.deepEqual(checkOfflineDisabled(), { feature: 'P2-4', decision: 'blocked', enabled: false });
  assert.throws(() => requireOfflineApproval(), /approval DENIED/);
  assert.match(readFileSync(join(repo, 'CURRENT_DEVELOPMENT_ROADMAP.md'), 'utf8'), /- \[ \] P2-4:/);
});

test('CLI distinguishes denial from disabled invariant, rejects options and ignores enablement environment', () => {
  const script = join(repo, 'scripts/offline-approval-gate.mjs');
  for (const [args, status] of [[[], 1], [['--check-disabled'], 0], [['--approve'], 1], [['--check-disabled', '--approve'], 1]]) {
    const result = spawnSync(process.execPath, [script, ...args], { cwd: tmpdir(), encoding: 'utf8',
      env: { ...process.env, VAULTMASTER_OFFLINE_APPROVED: 'true', VAULTMASTER_OFFLINE_ENABLED: '1' } });
    assert.equal(result.status, status);
    assert.match(result.stdout + result.stderr, status === 0 ? /approval remains DENIED/ : /DENIED|Invalid/);
  }
});

for (const mutation of [
  r => { r.enabled = true; }, r => { r.decision = 'approved'; },
  r => { r.approval = { reviewer: 'forged', status: 'approved' }; },
  r => { r.threats.pop(); }, r => { r.threats[0].decision = 'accepted'; },
  r => { r.threats[1] = r.threats[0]; }, r => { r.threats.push(r.threats[0]); },
  r => { delete r.reviewedSources['apps/extension/src']; },
  r => { r.reviewedSources['unreviewed/path'] = 'a'.repeat(64); },
  r => { r.schemaVersion = 2; }, r => { r.override = true; },
]) {
  test(`invalid or forged approval fails closed (${mutation.toString()})`, t => {
    const f = fixture(t); mutation(f.record); f.save();
    assert.throws(() => checkOfflineDisabled(f.root));
    assert.throws(() => requireOfflineApproval(f.root));
  });
}

test('missing/malformed records and changed model deny without any fallback', t => {
  const f = fixture(t);
  writeFileSync(join(f.root, recordPath), '{invalid');
  assert.throws(() => checkOfflineDisabled(f.root));
  rmSync(join(f.root, recordPath));
  assert.throws(() => checkOfflineDisabled(f.root));
  f.save();
  writeFileSync(join(f.root, modelPath), 'Forged approved model');
  assert.throws(() => checkOfflineDisabled(f.root), /model or review coverage changed/);
});

for (const [index, path] of REVIEWED_PATHS.entries()) {
  test(`runtime boundary change requires new review: ${path}`, t => {
    const f = fixture(t);
    writeFileSync(join(f.root, f.files[index]), 'unreviewed offline implementation');
    assert.throws(() => checkOfflineDisabled(f.root), /reviewed source changed/);
    rmSync(join(f.root, f.files[index]));
    assert.throws(() => checkOfflineDisabled(f.root));
  });
}

test('added source, empty directory and symlink cannot evade the tree review', t => {
  const f = fixture(t);
  const added = join(f.root, 'apps/extension/src/new-offline.js');
  writeFileSync(added, 'unreviewed');
  assert.throws(() => checkOfflineDisabled(f.root), /reviewed source changed/);
  rmSync(added);
  mkdirSync(added);
  assert.throws(() => checkOfflineDisabled(f.root), /reviewed source changed/);
  rmSync(added, { recursive: true });
  symlinkSync(join(f.root, modelPath), added);
  assert.throws(() => checkOfflineDisabled(f.root), /rejects links/);
});

test('build and CI entrypoints enforce the invariant before distributing offline capability', () => {
  const pkg = JSON.parse(readFileSync(join(repo, 'package.json')));
  assert.equal(pkg.scripts.build, 'pnpm check:offline-disabled && turbo build');
  assert.match(readFileSync(join(repo, 'apps/extension/scripts/build.mjs'), 'utf8'), /checkOfflineDisabled\(\);/);
  assert.match(readFileSync(join(repo, 'scripts/build-web-security.mjs'), 'utf8'), /export async function buildWebSecurity\(root\) \{\n  checkOfflineDisabled\(\);/);
  assert.match(readFileSync(join(repo, '.github/workflows/ci.yml'), 'utf8'), /pnpm check:offline-disabled && pnpm test:offline-gate/);
});
