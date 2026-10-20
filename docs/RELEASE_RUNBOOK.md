# Release runbook

This procedure prepares and accepts a VaultMaster release. It does not certify
independent security review or authorize offline unlock/fill. Use the
[terminology](TERMINOLOGY.md), [current roadmap](../CURRENT_DEVELOPMENT_ROADMAP.md)
and [recorded deployments](../DEPLOYMENT.md) together. Existing feature notes
describe historical checks; collect new evidence for the candidate SHA.

## Pin the candidate

1. Start from consolidated `main` on a development branch. Record the full
   candidate Git SHA, base SHA, scope and affected web/API/extension components.
   Keep the working tree clean before creating release artifacts.
2. Review migration changes and compatibility with current clients, key
   envelopes and v3/v4 backup formats. Do not combine a migration with an
   unreviewed change to encryption formats.
3. Update [the changelog](../CHANGELOG.md). Keep changes under Unreleased until
   delivery is accepted. An extension version must match both
   `apps/extension/package.json` and `apps/extension/src/manifest.json`; web/API
   releases also need their exact SHA and provider version IDs.
4. Inspect [the offline gate](OFFLINE_UNLOCK_FILL_VERIFICATION.md). A changed
   reviewed-source fingerprint is a review requirement, not a value to refresh
   automatically to make CI pass. P2-4 remains blocked.

## Validate the candidate

Use pnpm 9.15.0 and the Node 22 CI environment. Install with the frozen lockfile.
Read installed Turbo/Next documentation as required by repository AGENTS files.
Run database tests only against an isolated disposable PostgreSQL database;
never reuse production connection strings or user data.

The canonical command ordering and isolated database environment are in
[the CI workflow](../.github/workflows/ci.yml). It covers dependency review,
offline enforcement, recovery guards, documentation, Prisma generation and
migrations, lint/typecheck, static builds, reproducible Chromium packaging,
unit/database tests, real browsers and isolated client-key-exchange recovery.
Record the hosted run URL and verify that its head SHA equals the candidate.
Queued, skipped, cancelled or stale-SHA runs are not successful validation.

Also verify both release archives after the crypto build, sequentially:

```sh
pnpm --filter @vaultmaster/crypto build
pnpm --filter @vaultmaster/extension build
pnpm build:extension:firefox
pnpm --filter @vaultmaster/extension test
node --test apps/extension/tests/firefox/support.test.mjs
```

The release tests compare independently rebuilt archives and check inventories.
Build final distributable archives using the intended non-secret app/API origins
from [deployment configuration](../DEPLOYMENT.md), then verify each ZIP and
adjacent SHA-256 file. Development-origin test archives are not release assets.

```sh
pnpm package:extension test-results/vaultmaster-extension.zip
pnpm package:extension:firefox
pnpm verify:extension test-results/vaultmaster-extension.zip
pnpm verify:extension test-results/vaultmaster-firefox.zip
```

Run builds and browser/package tests sequentially: they share output/staging
directories. ZIP inventory/checksum verification proves consistency, not
publisher authenticity. Retain trusted release digests with the candidate SHA.
Use the [extension release policy](EXTENSION_STORE_PREPARATION.md) for identity,
permissions and install/update checks, and the [Firefox guide](FIREFOX_SUPPORT.md)
for signed-installation prerequisites and browser limitations.

On Windows, the offline-gate file-symlink test can report an explicit privilege
skip; junction rejection still runs. Require the Linux CI file-symlink check
before release acceptance. Record every skip or environment limitation.

## Prepare recovery

Before switching traffic, identify the exact known-good API deploy and web
asset/version IDs and test their compatibility with retained migrations and
installed clients. Follow [rollback policy](OBSERVABILITY_ROLLBACK.md) and the
[backup/restore drill](BACKUP_RESTORE_DRILL.md). A historical passing drill does
not prove that a new migration has a safe fallback.

Record a verified backup reference and recovery evidence without credentials or
user data. Confirm monitoring recipients, log routing and backup heartbeat if
claiming active monitoring. Do not mark monitoring operational merely because
health endpoints or synthetic alert tests pass.

## Deploy and verify

1. Promote the tested candidate to `deploy/free-hosting` for the API according
   to [deployment instructions](../DEPLOYMENT.md). Verify the actual Render
   deploy SHA/status: a successful push does not prove a deployment happened.
2. Apply committed migrations through the existing deployment path and verify
   readiness before publishing matching web assets. Record the Cloudflare
   version and asset identities. Preserve approved origins, cookies and CSP.
3. Verify public ZIP bytes against the retained release digests after
   propagation. Follow manual installation/update instructions; store delivery
   and signed Firefox installation need separate evidence.
4. With authorized disposable accounts, verify login, lock/reload/unlock,
   encrypted create/read/update, independent extension sync/fill and
   sensitive-action reauthentication. Exercise backup export/open/restore and
   retry behavior when affected. Remove test accounts and fixtures afterward.
5. Follow the readiness sampling and observation windows in the rollback
   policy. On incompatible migrations, failed synthetic checks or incorrect
   digests, stop acceptance and use the reviewed recovery procedure.

Production secrets, vault contents and account identifiers do not belong in
release logs. Do not reset production databases or assume a traffic rollback
undoes migrations. Already-open clients and installed extensions may continue
using newer code after a server rollback.

## Record acceptance

Keep a secret-free record in `docs/evidence/` and link it from DEPLOYMENT.md:

- Candidate/base SHA, CI run URL/result and environment/tool versions.
- Migration identifiers, compatibility decision, backup/drill evidence and
  approved rollback targets.
- Provider deploy/version IDs and extension versions/identities/SHA-256.
- Synthetic test results, cleanup status, observation window and monitoring
  delivery status.
- Remaining limitations, manual checks and maintainer acceptance.

Move the delivered scope from Unreleased into a dated changelog entry only
after acceptance. Leave unshipped work under Unreleased. Do not mark P2-5
complete on the strength of this runbook: independent review, a project-wide
threat model and security policy remain separate deliverables.
