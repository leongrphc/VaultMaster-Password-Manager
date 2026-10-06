# P2-4 blocked gate verification

6 October 2026, `feature/p2-4-offline-unlock-fill`.
[Threat model and decision](OFFLINE_UNLOCK_FILL_THREAT_MODEL.md),
[machine-readable policy](offline-unlock-fill-gate.json),
[secret-free check evidence](evidence/p2-4-offline-gate-checks.json).

**Approval is denied. P2-4 is not complete.** The threat review could not establish
acceptable device/update compromise protection, stolen-profile factor binding,
rollback-resistant expiry, offline revocation or recovery generation semantics.
Selected autofill values also become readable by the target page; isolation
cannot guarantee confidentiality against a compromised matching page.
No offline capability was implemented and the roadmap is unchanged.

The gate is enforced before root builds, extension builds/packages for both
browsers, static web CSP generation and CI quality checks. It pins runtime source
trees, manifests, build/security policies, dependency manifests and lockfile.
Runtime/dependency/model changes require review; there is no automatic pin refresh
or environment/consent/status override. This deliberately conservative guard is
not a malicious-publisher defense: a party controlling the repository/release
pipeline can replace it. Branch protection/signing and independent approval are
not configured or claimed by this change. Existing online session security and
pre-existing web snapshot/PRF fallback remain unchanged.

Passed locally, using synthetic fixtures/disposable profiles:

| Command/check | Result |
| --- | --- |
| `pnpm gate:offline` | Expected exit **1**, approval DENIED |
| `pnpm check:offline-disabled` | Exit 0; disabled invariant intact, no approval |
| `pnpm test:offline-gate` | 34 tests: absent/malformed/forged approval, threat omissions, model/source/dependency changes, additions/deletions/links, build/CI hooks, CLI and env denial |
| `pnpm --filter @vaultmaster/crypto test` | 25 tests; new authentic old-wrapper replay counterexample proves stable-DEK rewrap does not revoke a copied wrapper |
| `pnpm --filter @vaultmaster/extension test` | 87 tests; four new network/cache/profile replay/revocation denials plus existing lock/late-result/session/document tests |
| `NODE_OPTIONS=--no-experimental-webstorage pnpm --filter @vaultmaster/web test` | 119 tests; existing snapshot/cleanup, PRF, lock/multi-tab, recovery and session regressions |
| `node --test apps/api/tests/session-security.test.mjs` | 5 unit tests; live/revoked device and storage-error behavior, no live database |
| `pnpm lint` / `pnpm typecheck` | Passed; two existing web navigation lint warnings |
| `VAULTMASTER_STATIC_EXPORT=1 NODE_ENV=production pnpm build` | Static web/CSP, API, crypto/shared and Chromium extension build passed |
| `pnpm build:extension:firefox` / `pnpm test:extension:firefox` | Build and 2 real stock Firefox 157.0.1 regression/package tests passed; deterministic verified archives |
| `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 pnpm test:extension:browser` | 24 real Chromium extension regressions passed |
| `pnpm test:docs` | 4 existing documentation/copy gates passed |
| `pnpm test:dependency-audit` / `pnpm audit:dependencies` / `pnpm audit --audit-level=critical` | 3 policy tests and all/prod/dev/critical gates passed; two existing reviewed high advisory constraints, zero unreviewed findings |
| `pnpm test:backup-drill-safety` | 6 isolated-runner safety guards passed; these are not recovery drills |
| `pnpm install --frozen-lockfile` / `git diff --check` | Passed |

Before editing, 15 extension session tests and 36 focused web snapshot/PRF/cleanup/
session tests passed. The first full extension run correctly rejected the release
test's added source-map fixture; the test now expects packaging denial, removes
the fixture and then verifies clean reproducible packaging. An intermediate test
used a synchronous assertion for the asynchronous package helper; corrected to
`assert.rejects`. Neither failed run is counted as passing. Final extension,
Firefox and Chromium runs all exited 0.

Browser checks exercise the existing online extension against synthetic HTTP
fixtures, including protected fill, lock/unlock, navigation, software passkeys,
revocation (Chromium), temporary update and restart. They do not approve offline
unlock/fill, prove trusted monotonic time, hardware PRF protection, compromised
host/publisher resistance or signed Firefox store delivery. The crypto replay
counterexample documents an unresolved risk rather than a new protection.

Because approval is denied, no offline crypto/API implementation, full API/database
integration suite, new P2-4 web browser scenario, clock rollback/device recovery
browser drill, signed update/hardware-factor check or isolated personal/database/
exchange recovery drill was performed for this change. Those implementation
acceptance checks remain mandatory if a later review permits a candidate. Existing
safety-guard/unit results must not substitute for them. No production data,
deployment, store publication, hosted CI result or independent audit is claimed.
P2-5 was not started.
