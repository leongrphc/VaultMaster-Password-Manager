import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

// pnpm 9's dev flags/counts are not reliable classification evidence. Keep
// explicit audit scopes and every dependency path instead.
export function normalizeAudit(raw) {
  if (!raw || raw.error || !raw.advisories || !raw.metadata?.vulnerabilities || raw.muted?.length) {
    throw new Error('Missing, failed or muted registry audit response');
  }
  const findings = Object.values(raw.advisories).map(a => {
    if (!/^GHSA-[a-z0-9-]+$/.test(a.github_advisory_id) ||
        !['info', 'low', 'moderate', 'high', 'critical'].includes(a.severity) ||
        typeof a.module_name !== 'string' || !a.findings?.length ||
        a.findings.some(f => typeof f.version !== 'string' || !f.paths?.length ||
          f.paths.some(p => typeof p !== 'string'))) {
      throw new Error('Invalid registry advisory');
    }
    return {
      id: a.github_advisory_id, package: a.module_name, severity: a.severity,
      patchedVersions: a.patched_versions,
      url: `https://github.com/advisories/${a.github_advisory_id}`,
      occurrences: a.findings.map(f => ({ version: f.version, paths: f.paths })),
    };
  });
  for (const severity of ['info', 'low', 'moderate', 'high', 'critical']) {
    if (raw.metadata.vulnerabilities[severity] !== findings.filter(f => f.severity === severity).length) {
      throw new Error('Incomplete registry advisory counts');
    }
  }
  return { counts: raw.metadata.vulnerabilities, findings };
}

export function reviewAudit(audit, scope, exceptions, today) {
  return audit.findings.filter(finding => !exceptions.some(e =>
    finding.severity !== 'critical' && e.id === finding.id && e.package === finding.package &&
    e.severity === finding.severity && e.scopes.includes(scope) && e.expires > today &&
    finding.occurrences.every(o => o.version === e.version &&
      o.paths.every(p => e.paths.includes(p)))
  ));
}

export function runAudit() {
  const exceptions = JSON.parse(readFileSync(new URL('../docs/dependency-audit-exceptions.json', import.meta.url)));
  const version = spawnSync('pnpm', ['--version'], { cwd: root, encoding: 'utf8', timeout: 10_000 });
  if (version.error || version.status !== 0 || !/^\d+\.\d+\.\d+$/.test(version.stdout.trim())) {
    throw new Error('Cannot verify the audit package manager version');
  }
  const report = {
    date: new Date().toISOString(), node: process.version, pnpm: version.stdout.trim(),
    lockfileSha256: createHash('sha256').update(readFileSync(`${root}pnpm-lock.yaml`)).digest('hex'),
    scopes: {},
  };
  const today = report.date.slice(0, 10);
  let failed = false;
  for (const scope of ['all', 'prod', 'dev']) {
    const args = ['audit', ...(scope === 'all' ? [] : [`--${scope}`]), '--json'];
    const result = spawnSync('pnpm', args, { cwd: root, encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
    try {
      if (result.error || ![0, 1].includes(result.status)) throw new Error('Audit command failed');
      const audit = normalizeAudit(JSON.parse(result.stdout));
      const unreviewed = reviewAudit(audit, scope, exceptions, today);
      report.scopes[scope] = { command: `pnpm ${args.join(' ')}`, exitCode: result.status, ...audit, unreviewed };
      console.log(`${scope}: ${JSON.stringify(audit.counts)}; ${unreviewed.length} unreviewed`);
      for (const f of unreviewed) console.error(`${scope}: ${f.id} (${f.package}, ${f.severity}) requires review`);
      failed ||= unreviewed.length > 0;
    } catch {
      // Never echo registry error payloads, environment variables or auth headers.
      report.scopes[scope] = { command: `pnpm ${args.join(' ')}`, error: 'Audit unavailable or invalid; review failed closed' };
      console.error(`${scope}: audit unavailable or invalid; review failed closed`);
      failed = true;
    }
  }
  mkdirSync(`${root}test-results`, { recursive: true });
  writeFileSync(`${root}test-results/dependency-audit.json`, JSON.stringify(report, null, 2) + '\n');
  process.exitCode = failed ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) runAudit();
