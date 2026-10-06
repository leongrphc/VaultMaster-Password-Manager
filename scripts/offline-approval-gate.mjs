import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const RECORD = 'docs/offline-unlock-fill-gate.json';
const MODEL = 'docs/OFFLINE_UNLOCK_FILL_THREAT_MODEL.md';
// Fixed coverage: the record cannot remove a runtime boundary from the review.
export const REVIEWED_PATHS = Object.freeze([
  'apps/api/src', 'apps/extension/src', 'apps/web/src', 'apps/web/public',
  'packages/crypto/src', 'packages/shared/src', 'apps/web/next.config.ts',
  'apps/extension/scripts/build.mjs', 'scripts/build-web-security.mjs',
  'scripts/extension-release-policy.mjs', 'scripts/package-extension.mjs',
  'pnpm-lock.yaml', 'package.json', 'apps/api/package.json',
  'apps/extension/package.json', 'apps/web/package.json',
  'packages/crypto/package.json', 'packages/shared/package.json',
]);
export const THREATS = Object.freeze([
  'device-compromise', 'stolen-profile', 'page-compromise', 'malicious-update',
  'replay-rollback', 'stale-revoked-device', 'clipboard', 'lock-timeout',
  'multi-tab-races', 'recovery-backup',
]);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sameKeys = (object, keys) => object && !Array.isArray(object) &&
  JSON.stringify(Object.keys(object).sort()) === JSON.stringify([...keys].sort());

// Hash relative names and bytes in deterministic order; include added/deleted
// files and reject links/special files rather than following them outside review.
export function fingerprint(repoRoot, relativePath) {
  const entries = [];
  function visit(path) {
    const absolute = join(repoRoot, path);
    const stat = lstatSync(absolute);
    if (stat.isDirectory()) {
      entries.push([path, 'directory']);
      for (const name of readdirSync(absolute).sort()) visit(`${path}/${name}`);
    } else if (stat.isFile()) entries.push([path, sha256(readFileSync(absolute))]);
    else throw new Error('P2-4 review rejects links or special files');
  }
  visit(relativePath);
  return sha256(JSON.stringify(entries));
}

export function checkOfflineDisabled(repoRoot = ROOT) {
  const record = JSON.parse(readFileSync(join(repoRoot, RECORD), 'utf8'));
  if (!sameKeys(record, ['schemaVersion', 'feature', 'decision', 'enabled', 'approval', 'threats', 'modelSha256', 'reviewedSources']) ||
      record.schemaVersion !== 1 || record.feature !== 'P2-4' || record.decision !== 'blocked' ||
      record.enabled !== false || record.approval !== null) {
    throw new Error('P2-4 has no approved enablement path; security review required');
  }
  if (!Array.isArray(record.threats) || record.threats.length !== THREATS.length ||
      record.threats.some((entry, i) => !sameKeys(entry, ['id', 'decision']) || entry.id !== THREATS[i] ||
        entry.decision !== (['clipboard', 'multi-tab-races'].includes(entry.id) ? 'unverified' : 'blocked'))) {
    throw new Error('P2-4 threat coverage or decision changed; security review required');
  }
  if (record.modelSha256 !== fingerprint(repoRoot, MODEL) || !sameKeys(record.reviewedSources, REVIEWED_PATHS)) {
    throw new Error('P2-4 model or review coverage changed; security review required');
  }
  for (const path of REVIEWED_PATHS) {
    if (record.reviewedSources[path] !== fingerprint(repoRoot, path)) {
      throw new Error(`P2-4 reviewed source changed: ${path}; security review required`);
    }
  }
  return Object.freeze({ feature: 'P2-4', decision: 'blocked', enabled: false });
}

export function requireOfflineApproval(repoRoot = ROOT) {
  checkOfflineDisabled(repoRoot);
  throw new Error('P2-4 approval DENIED: unresolved threat model; offline unlock/fill must remain disabled');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === '--check-disabled') {
      checkOfflineDisabled();
      console.log('P2-4 disabled invariant verified; approval remains DENIED');
    } else if (args.length === 0) requireOfflineApproval();
    else throw new Error('Invalid P2-4 gate arguments');
  } catch (error) {
    // Emit fixed policy errors only, never raw file/parser errors or storage data.
    console.error(error.message.startsWith('P2-4') || error.message === 'Invalid P2-4 gate arguments'
      ? error.message : 'P2-4 gate unavailable or malformed; approval DENIED');
    process.exitCode = 1;
  }
}
