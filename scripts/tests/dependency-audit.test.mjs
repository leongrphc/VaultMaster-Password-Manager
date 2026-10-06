import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAudit, reviewAudit } from '../dependency-audit.mjs';

const advisory = {
  github_advisory_id: 'GHSA-test-test-test', module_name: 'fixture', severity: 'high',
  findings: [{ version: '1.0.0', paths: ['apps/api > fixture@1.0.0'] }],
};
const response = () => ({ advisories: { 1: structuredClone(advisory) }, muted: [],
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0 } } });
const exception = { id: advisory.github_advisory_id, package: 'fixture', version: '1.0.0',
  severity: 'high', scopes: ['all', 'dev'], expires: '2026-11-05', paths: advisory.findings[0].paths };

test('review permits only the reviewed package, version, scope, path and period', () => {
  const audit = normalizeAudit(response());
  assert.equal(reviewAudit(audit, 'all', [exception], '2026-10-06').length, 0);
  for (const changed of [
    { package: 'other' }, { version: '1.0.1' }, { paths: ['different'] },
    { id: 'GHSA-new-test-test' }, { severity: 'moderate' },
  ]) {
    assert.equal(reviewAudit(audit, 'all', [{ ...exception, ...changed }], '2026-10-06').length, 1);
  }
  assert.equal(reviewAudit(audit, 'prod', [exception], '2026-10-06').length, 1);
  assert.equal(reviewAudit(audit, 'all', [exception], '2026-11-05').length, 1);
  audit.findings[0].occurrences[0].paths.push('apps/web > fixture@1.0.0');
  assert.equal(reviewAudit(audit, 'all', [exception], '2026-10-06').length, 1);
});

test('critical findings cannot be excepted', () => {
  const audit = normalizeAudit(response());
  audit.findings[0].severity = 'critical';
  assert.equal(reviewAudit(audit, 'all', [{ ...exception, severity: 'critical' }], '2026-10-06').length, 1);
});

test('missing, failed, muted, malformed and incomplete responses fail closed', () => {
  for (const raw of [null, {}, { error: 'registry unavailable' },
    { ...response(), muted: ['ignored'] }, { ...response(), advisories: {} }]) {
    assert.throws(() => normalizeAudit(raw));
  }
  const malformed = response();
  malformed.advisories[1].findings[0].paths = [];
  assert.throws(() => normalizeAudit(malformed));
  const clean = response();
  clean.advisories = {};
  clean.metadata.vulnerabilities.high = 0;
  assert.deepEqual(normalizeAudit(clean).findings, []);
});
