# VaultMaster deployment

The web app runs as a Next.js static export using Cloudflare Workers Static Assets. The Express API
runs on Render Free and connects to a new Neon PostgreSQL database. Secrets belong
in Render environment variables, never in the web build or repository.

Current deployment:

- Web: https://vaultmaster.mozkan.com.tr
- API: https://vaultmaster-api.onrender.com/api
- Render service: `srv-db1touh42hec73e7qkg0`, Frankfurt, Free.
- Neon project: `young-shape-45320139`, AWS Frankfurt, organization Free.
- Cloudflare Worker: `vaultmaster-web`, configured in `wrangler.web.jsonc`.
- Deployment branch: `deploy/free-hosting` (Render auto-deploys this branch).

### Verified release — 2026-10-05

- Production code: `d1aaa236303dfce6ce762d410aff342c59fcc475`.
- Render deploy: `dep-db206fbbc2fs73eo09sg`, live; both new key-envelope and
  backup-receipt migrations applied successfully before the web cutover.
- Cloudflare version: `e5ce251d-f556-44b0-a13c-86b6d8be6ec3`.
- Chrome/Edge extension 1.1.0:
  https://vaultmaster.mozkan.com.tr/downloads/vaultmaster-extension.zip.
- Validation: 174 unit/integration tests, real Chromium web and MV3 extension
  tests, production builds and Worker deployment validation passed. All 45 API
  tests ran against an empty database on a temporary schema-only Neon branch;
  the branch was deleted afterward. Production data was not used for these tests.
- Live verification used disposable accounts: HttpOnly cookies, CSRF/CSP,
  exact ZIP digest, web login/reload lock/unlock, extension login/lock/unlock
  without a web vault tab, HTTPS fixture autofill, password change preserving
  encrypted data, device revocation and idempotent backup restore all passed.
  The accounts and fixture data were deleted.
- GitHub Actions run [37366208999](https://github.com/leongrphc/VaultMaster-Password-Manager/actions/runs/37366208999)
  initially ended before any step ran because no hosted runner acquired the job
  during an Actions incident. It was retried; the release used the independent
  local/browser and isolated PostgreSQL verification above, not a claimed green
  CI result.

Existing web sessions require a fresh login after this release. To install the
extension, extract the ZIP, enable Developer mode at `chrome://extensions` or
`edge://extensions`, then load the extracted directory as an unpacked extension.
It is not published in either browser's extension store yet.

The Pages fallback is `https://vaultmaster-mozkan.pages.dev`. Its hostname was
unreachable from the local network during setup, so the primary deployment uses
the existing `mozkan.com.tr` zone. Wrangler creates the custom-domain DNS record
and certificate for the Worker; no new domain purchase is needed.

## API

Use `render.yaml` to create the service from this repository. Supply:

- `DATABASE_URL`: Neon's pooled PostgreSQL connection URL with TLS.
- `DATABASE_DIRECT_URL`: Neon's direct connection URL with TLS.
- `CORS_ORIGIN`: the primary HTTPS production origin first, without a trailing slash.
  Current value: `https://vaultmaster.mozkan.com.tr,https://vaultmaster-mozkan.pages.dev`.

Render generates the JWT and application encryption secrets. Keep those values
stable across deployments. `PORT` is supplied by Render. Startup applies committed
Prisma migrations before serving requests. `/api/health/ready` checks the database.

The initial migration is for a **new, empty database**. An existing database needs
its migration history baselined before deploying; do not reset existing vault data.
Render Free sleeps after inactivity, so the first API request may take longer.

## Web

From the repository root in PowerShell:

```powershell
$env:VAULTMASTER_STATIC_EXPORT = '1'
$env:VAULTMASTER_APP_URL = 'https://vaultmaster.mozkan.com.tr'
$env:VAULTMASTER_API_URL = 'https://vaultmaster-api.onrender.com/api'
pnpm --filter @vaultmaster/web... build
npx wrangler deploy --config wrangler.web.jsonc
```

The web client always uses same-origin `/api`. `API_ORIGIN` in
`wrangler.web.jsonc` selects the upstream API; the Worker forwards cookie and
Origin headers without redirects or caching. Only `/api/*` invokes the Worker;
static files use direct asset delivery. The web deployment is
currently a direct upload: pushing to GitHub redeploys the API, but does not
automatically publish a new web build. Run the build and Wrangler commands above
for web changes. The old Pages fallback cannot serve this client without an
equivalent same-origin API proxy; do not publish this build there alone.

## Extension

```powershell
$env:VAULTMASTER_APP_URL = 'https://vaultmaster.mozkan.com.tr'
$env:VAULTMASTER_API_URL = 'https://vaultmaster-api.onrender.com/api'
pnpm --filter @vaultmaster/extension... build
```

Load `apps/extension/dist` as an unpacked extension in Chrome/Edge. The popup signs
in and unlocks independently of the web app. Static web builds automatically
package `/downloads/vaultmaster-extension.zip` and link to it from Settings.
Set both build origins above before publishing the web; the ZIP uses those same
origins. Extension bearer traffic uses the direct API, not the web cookie proxy.
Set `WEBAUTHN_EXTENSION_ORIGINS=chrome-extension://cajnckjhhpbgephllmoaceolbifmnkoa`
on Render before publishing. `manifest.key` is a public identity key that keeps
the unpacked Chrome ID stable. Only configured IDs may perform WebAuthn login;
credential registration still uses the website origin. A future store ID must
be verified and explicitly added, never accepted via an origin wildcard.
An origin change also requires rebuilding the extension and updating API CORS.
WebAuthn credentials and browser local unlock are tied to their original origin.

The native device session and DEK are stored only in `chrome.storage.session`
with `TRUSTED_CONTEXTS` access, which Chrome keeps in memory and clears on browser
restart, extension reload/update/disable. Persistent extension storage contains
only encrypted record snapshots, preferences and selection metadata. No password
is retained after login. The key survives worker restarts only until an absolute
five-minute deadline; a Chrome alarm, every-request checks and device-lock events
enforce lock. Lock removes the key, plaintext items and pending draft/fill state.
Login, unlock and secret fills require a reachable API. Device revocation and
password changes from the web are checked on the next request. This version does
not provide offline unlock/fill or Firefox support. WebAuthn is account login;
stored vault passkeys still do not implement signing on third-party websites.

References: [Chrome session storage](https://developer.chrome.com/docs/extensions/reference/api/storage),
[alarms](https://developer.chrome.com/docs/extensions/reference/api/alarms), and
[Chromium WebAuthn extension origins](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/browser/webauth/origins.md).

## Verification

Check API readiness, register a disposable account, create a login item, lock and
unlock the vault, and check autofill on a controlled test site. Delete the disposable
account afterward. Test the real browser extension in addition to automated tests.


## Session security regression checks

The production release uses `__Host-` HttpOnly, Secure, SameSite=Strict
cookies for web access and refresh credentials. Web responses contain a session
flag rather than JWTs; browser storage contains public session metadata only.
Mutations require `X-VaultMaster-Client: web`, an exact allowed Origin and a
non-cross-site fetch. Native bearer clients retain their existing API contract.
Browser Web Locks serialize login, logout and refresh across tabs; before rotating,
refresh checks whether another tab already renewed the access cookie. Storage
events propagate lock, logout and account changes without propagating keys.

Deploy the compatible API first, then the Worker and static web assets together.
Storage version 5 drops earlier persisted JWT sessions and requires a fresh login.
Keep the primary web origin in `CORS_ORIGIN`. Secure cookies require HTTPS in
production; local development uses the Next same-origin proxy to port 4000.
These changes are live in the verified release recorded above.

Static builds generate a hash-based Content-Security-Policy from exported HTML.
Script execution allows self and exact build hashes, with no unsafe-inline/eval
or inline event handlers. Styles retain unsafe-inline for the existing UI.
External connections allow only the password leak API and the configured HTTPS
Sentry DSN origin. The build fails if CSP exceeds Cloudflare's 2,000-character
header line limit. Chromium checks blocked injected scripts, working navigation,
cookie invisibility, and two-tab lock/logout alongside password and backup flows.

The web vault's master key stays in memory. Client navigation after login retains
the unlocked vault; a full page reload restores authentication with the vault
locked. Legacy plaintext session keys are removed. Offline snapshots and lock
verifiers remain encrypted. Delayed loads, saves, downloads and unlocks are
invalidated when their unlocking session changes.

```powershell
pnpm --filter @vaultmaster/web test
$env:VAULTMASTER_STATIC_EXPORT = "1"
pnpm --filter @vaultmaster/web build
pnpm test:web:browser
```

The browser test serves the static export locally and intercepts all API calls;
it does not use production accounts or data.


API session tokens now carry a device ID, token purpose, issuer, audience and a
random JWT ID. Protected requests check that device's current authorization;
logout, device revocation and refresh-token reuse block its next API request.
A master-password change revokes other devices. Deploying this token format
requires existing sessions to sign in again. No database migration is needed.


## Isolated CI database

GitHub Actions provisions an ephemeral PostgreSQL 17 service, applies the real
Prisma migrations, and runs API integration tests plus web/extension regression
checks. Integration tests require `VAULTMASTER_TEST_DATABASE_URL` explicitly;
they never select the deployment connection from `.env`. For local testing, point
this variable and `DATABASE_URL` / `DATABASE_DIRECT_URL` at a dedicated database,
apply migrations there, build the API, then run its tests.

## Vault key envelopes and password changes

Apply `20261005000000_vault_key_envelope` before deploying the new API, then
publish the updated web build. The migration is additive: existing accounts keep
version 0 and their original password-derived data key. The new web client creates
random AES-256 data keys for new accounts. On a legacy account's first password
change it wraps the existing data key, preserving all ciphertext and timestamps.
Later changes rewrap that same key. AES-GCM authenticates the envelope with a
purpose-specific AAD string; plaintext keys are never sent to the API or persisted.

The API atomically changes the authentication hash, encrypted key envelope and
version, and revokes other devices. Compare-and-swap checks the verified hash and
expected version, so concurrent changes cannot overwrite each other. The old
item-replacement password-change payload is rejected. Envelope accounts require
`vaultKeyProtocol: 1` at login so old clients cannot encrypt new data with a
password key. Login and manual unlock decrypt the envelope; online manual unlock
refreshes its server version, recovering if a change response was lost. An
unreachable API allows encrypted offline metadata, while API authentication and
server errors do not silently allow offline manual unlock.

This is a password change, not rotation of a compromised data key. Someone who
already copied a data key or an old encrypted offline snapshot can still decrypt
that copy. Legacy data keys can still be derived from the original password if
it is known. Fully retiring a compromised DEK needs complete re-encryption of all
ciphertext and a separate migration. Earlier password changes that already left
history or files under an unknown old key cannot be repaired by this migration.
The existing client KDF profile (email salt, 600,000 PBKDF2 rounds) is unchanged;
configurable KDF profile migration remains on the roadmap.

After any envelope is active, rolling back to an API or client that ignores it
can cause unreadable writes. Keep the envelope-aware API when reverting unrelated
changes, or restore the entire database and matching application from a verified
backup. The older item export is not a complete server-loss backup. Use the version 3
full personal backup described below for history, trash, files and key recovery.
Cross-tab coordination and independent extension unlock are included in this release.

Envelope regression tests live in the crypto, web and API test suites. API tests
run only against the explicitly selected disposable database. The real Chromium
web test covers random-key registration, encrypted storage, password change and
reload/unlock with the new password.
Architecture reference: [OWASP Key Management](https://cheatsheetseries.owasp.org/cheatsheets/Key_Management_Cheat_Sheet.html).

## Portable full personal backups (version 3)

Apply `20261005010000_backup_restore_receipts` before deploying the backup API.
Settings → Veri Yönetimi → Tam Şifreli Kasa Yedeği creates a standalone JSON file
protected with a separate backup password (minimum 12 characters). PBKDF2-SHA256
uses a fresh 32-byte random salt and 600,000 rounds; AES-256-GCM uses a random
96-bit IV and authenticates the format/version/KDF header as AAD. Work factors
and versions are validated before performing expensive derivation.

The encrypted archive contains its backup ID, date, source email, stable data
key, folders, active/deleted items, every stored item version, and attachment
metadata/blobs with timestamps. All of this, including the data key, is inside
the outer encryption. Neither plaintext keys nor passwords are sent to the API.
The API snapshot uses a repeatable-read transaction and scopes every record to
the authenticated account. Every ciphertext and attachment size is verified in
the client before the download; unreadable old history aborts the entire export.

Recovery needs this file and its backup password, plus an unlocked destination
VaultMaster account. It does not need the old server, source account, original
email/password combination, or original password wrapper. The client validates
the file, displays counts and waits for the user's “Mevcut Kasaya Ekle” click.
Then it decrypts every content type and re-encrypts it for the destination DEK.
The server generates new IDs, maps folder/item references, preserves timestamps,
history and deletion state, and commits everything plus a restore receipt in one
transaction. Existing destination records are never overwritten or deleted.
Retries with the same backup ID return the existing receipt without inserting
copies. A history reference to an already-deleted folder becomes null; that
folder's name was already absent from the source database.

This is a complete *personal vault* data backup, not an account/server image.
Sessions, login 2FA secrets/recovery codes, WebAuthn credentials, sharing and
emergency access relationships are excluded. They must be configured again on
the destination. The existing partial JSON/CSV imports remain available and are
separate from full backup recovery.

This first format supports at most 16 MiB of serialized encrypted snapshot data,
10,000 folders/items, 10,000 versions and 1,000 files per item, and a 24 MiB file.
Over-limit accounts fail explicitly; no content is dropped. Version 4, described
below, provides bounded chunking for larger vaults. A copied backup remains decryptable
with its backup password after account/password changes; store it accordingly.
The backup password cannot be reset by the service.

CI recovery drills delete the source test account, decrypt its saved archive,
restore to another account, verify ciphertext with the destination key, preserve
existing records, retry concurrently, and inject a transaction failure to prove
rollback. Chromium tests exercise download, wrong-password rejection, preview
and explicit restore. Production data is not used.
Reference: [OWASP Key Management](https://cheatsheetseries.owasp.org/cheatsheets/Key_Management_Cheat_Sheet.html).

## Chunked personal backups (version 4, P0-1)

Apply `20261006000000_chunked_backup_transfers` before deploying the API; deploy
that API before the new web client. Version 3 files and the legacy `/snapshot`
and `/restore` contracts remain supported with their original limits. New web
exports use version 4 JSON, with the same personal archive contents and independent
backup password. Older clients cannot open version 4 files.

Version 4 uses PBKDF2-SHA256 (600,000 iterations, fresh 32-byte salt) and
AES-256-GCM (128-bit tags, fresh random 96-bit IV per chunk). UTF-8 archive bytes
are divided into 1 MiB chunks. Each chunk authenticates the canonical header
`{format, version, kdf, chunkBytes, totalBytes, chunkCount}` plus its zero-based
`index`. Fixed chunk size, exact lengths/count/order and KDF parameters are
validated before derivation. Reordering/relabeling, duplication, truncation,
header edits or ciphertext edits fail the entire archive. No preview or restore
is available before all chunks and all contained vault ciphertext are verified.
The source DEK, email and folders stay inside the password-encrypted file.

Explicit limits:

- Version 4 encrypted snapshot JSON: 64 MiB; archive/transfer payload: 65 MiB;
  downloadable JSON: 90 MiB. Chunk size: 1 MiB, at most 65 chunks.
- The existing 10,000 folders/items, 10,000 versions per item and 1,000 attachments
  per item schema limits remain. Attachments retain the existing 25 MiB limit.
- Transfer chunk HTTP bodies: 1,400 KiB (base64 plus envelope). Authenticated chunk
  traffic has its own 400-request/account/15-minute budget; other API operations
  retain their existing request limits.
- One staged export and at most two unfinished restores per account, valid for
  one hour. New exports replace that account's previous staged export.

`GET /api/backups/snapshot?version=4` freezes an account-scoped repeatable-read
snapshot and returns `{transferId,totalBytes,chunkCount}`. Fetch its immutable
base64 chunks with `GET /transfers/:id/chunks/:index`. Restore starts with
`POST /transfers` and `{totalBytes,chunkCount}`, uploads sequential chunks using
`PUT /transfers/:id/chunks` and `{index,data}`, then uses `POST /transfers/:id/commit`.
All paths are under `/api/backups`, require current account authentication and
return `Cache-Control: no-store`. Duplicate uploads must match accepted bytes;
conflicting or out-of-order uploads and incomplete commits fail explicitly.
`DELETE /transfers/:id` discards only the authenticated account's transfer.

The web re-encrypts every record/history/file for the destination DEK before
uploading. Staging contains that ciphertext and the existing snapshot metadata;
it never receives the source DEK, backup password or decrypted vault secrets.
Commit strictly validates the assembled snapshot and uses the same atomic,
additive import and unique backup receipt as version 3. Concurrent/lost-response
commit retries cannot insert duplicates. No staging data becomes visible in the
vault before commit. The web retries network failures up to three attempts for
immutable chunk reads/writes and commit, checking its vault-session guard each
time. HTTP errors are surfaced, not blindly retried.

Limitations: this is bounded chunking, not constant-memory streaming. Snapshot
creation, file opening and final transactional import still assemble data in
memory; concurrent maximum-size jobs need memory headroom on Render Free.
The web does not persist a transfer handle or resume automatically across a page
reload. Interrupted API transfers can retry with their existing handle until
expiry; a new web attempt starts a new transfer. Completed or abandoned web transfers are deleted
by the client on a best-effort basis. Expired transfers are inaccessible immediately and physically
removed on the account's next transfer creation/export or account deletion.
For inactive accounts, run this maintenance SQL periodically on the server:

```sql
DELETE FROM backup_transfers WHERE "expiresAt" < CURRENT_TIMESTAMP;
```

Rollback can retain the additive migration and old backup endpoints; revert the
web to version 3 only if users understand it cannot read newly downloaded v4
files. Keep v4 files and their passwords; no account reset can recover them.
Operational server backups/recovery drills remain separate roadmap work.

P0-1 verification on 2026-10-06 (local test data only):

```sh
node --test packages/crypto/tests/chunked-backup.test.mjs
pnpm --filter @vaultmaster/web test tests/full-backup.test.ts tests/backup-transfer.test.ts
VAULTMASTER_TEST_DATABASE_URL=<disposable-postgresql> node --test apps/api/tests/backups.integration.test.mjs
node --test packages/crypto/tests/*.test.mjs
NODE_OPTIONS=--no-experimental-webstorage pnpm --filter @vaultmaster/web test
VAULTMASTER_TEST_DATABASE_URL=<disposable-postgresql> node --test apps/api/tests/rate-limit.integration.test.mjs
pnpm typecheck
pnpm lint
VAULTMASTER_STATIC_EXPORT=1 pnpm build
node --test tests/browser/session-security.mjs
```

The focused suites ran first. All 5 migrations applied to a new disposable
PostgreSQL 18 instance. Results: 14 crypto tests, 74 web tests, 5 backup integration
tests, 1 existing rate-limit test, 1 Chromium flow passed; typecheck, lint and
static production build passed. Lint retains 3 existing navigation warnings.
This host's Node web-storage global required `--no-experimental-webstorage` for
the full Vitest suite; Playwright on Ubuntu 26.04 required
`PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64` and a locally downloaded
Chromium (`PLAYWRIGHT_BROWSERS_PATH` under ignored `node_modules`). No production
services were deployed or queried for verification.

## Repeatable isolated recovery drill (P0-2)

Run `pnpm drill:backup-restore` using the
[backup/restore runbook](docs/BACKUP_RESTORE_DRILL.md). The harness provisions its
own local PostgreSQL cluster with TCP disabled, applies the real migrations and
uses synthetic accounts only. It accepts no database URL and discards inherited
production credentials and telemetry settings. API test servers bind to loopback.

The drill covers v4 creation/chunk transfer, source-account deletion, recovery
into a second account with a new key, duplicate upload/commit retries, a failure
injected after all data inserts, and verified transaction rollback. It also
creates a custom PostgreSQL dump, restores it to a second empty database, compares
every public table, verifies decryption, and removes both accounts and the cluster.
No production services are contacted and no production backup is claimed.

Verification on 2026-10-06: repeated successful isolated PostgreSQL 18.6 drills;
5 existing backup integration tests, 2 isolation guard tests, 14 crypto tests and
74 web tests passed. Frozen-lockfile install, typecheck, lint and static production
build passed. Lint retains the 3 existing navigation warnings. The web suite used
`NODE_OPTIONS=--no-experimental-webstorage` on Node 26.10.0. Secret-free
[rollback and recovery evidence](docs/evidence/p0-2-backup-restore-drill.json)
records before/inside/after counts, one receipt after retries, all 16 public tables
matching after server recovery, and cleanup. Provider PITR, live recovery timing,
production-scale performance and deployment rollback are not exercised here.

## Sensitive-action security (P0-4)

Apply `20261006020000_sensitive_action_security` before the new API/web release.
Deploy API first, then the web assets. Sensitive operations now require a
five-minute, single-use, account/device/method/path-bound proof from
`POST /api/auth/reauthenticate`, with the existing master-password hash and a
configured login factor. Older/native clients must implement that endpoint/header
for sensitive operations; login, sync, refresh and logout keep their contracts.

PostgreSQL now holds all rate-limit counters and the account-scoped security inbox.
Keep the trusted one-hop ingress configuration and schedule expired-row cleanup.
Policy, budgets, notification/privacy behavior, maintenance SQL, rollback effects
and limitations are documented in
[the P0-4 security record](docs/SENSITIVE_ACTION_SECURITY.md).
This branch was tested locally with synthetic data; it has not been deployed.
