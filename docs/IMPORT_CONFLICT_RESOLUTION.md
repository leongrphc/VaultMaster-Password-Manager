# Import conflict resolution (P1-3)

CSV, account-key-encrypted legacy JSON and portable v3/v4 full backups now use an
unlocked-client review followed by the existing staged, transactional restore
transport. No encryption format, KDF, key-envelope or database migration changes.
Deploy the API before the web. No production deployment or independent audit is
claimed. The extension has no file-import endpoint/UI: its native login, ciphertext
sync and explicitly approved form-save flows remain unchanged and regression-tested.

## Deterministic identity and decisions

Detection runs entirely in the unlocked web client. Ciphertexts are decrypted and
validated locally; identities are never uploaded, persisted, logged or included
in reports. Object keys have a stable order; omitted/empty optional fields compare
equally, tags compare as an exact case-sensitive set, and other array order and
custom-field identifiers are preserved. There is no fuzzy matching.

| Record | Detection | Decision |
| --- | --- | --- |
| Exact duplicate | Equal entire supported content (including title, credentials, notes, custom fields and tags), resolved folder, favorite and active/trash state; incoming record has no history/attachments | Skip automatically, including repeats within the file; existing record stays intact |
| Same login update | HTTP(S) URL origin (scheme, canonical host, effective port) plus exact case/whitespace-sensitive username; paths/query/fragments excluded | Default skip; explicitly keep both or replace a single active destination |
| Renamed / metadata conflict | Equal content excluding title, with different title or folder/favorite/trash metadata | Same choices; ambiguous destinations cannot be replaced |
| Non-login item | Exact full-content comparison, or equal content excluding title | Same conservative decisions; no title-only or card-number-only matching |
| History/attachments in incoming backup | Such records are never auto-skipped as exact: current-content equality cannot establish complete historical/file equality | Default skip or explicitly keep a separate complete copy; no overwrite/merge |
| Trash | Participates in detection, including exact active/trash distinction | Retain trash; never overwrite or implicitly revive it |
| Ambiguous / repeated matching accounts | More than one current or earlier-file identity candidate | Skip or keep both; no guessed replacement |

Scheme-less URLs use HTTPS for identity only. Invalid/non-HTTP URLs, embedded URL
credentials, absent usernames and absent URLs cannot establish login identity;
only exact-content/rename comparison remains. HTTP and HTTPS identities are
separate. New records are added after review approval. Exact-duplicate suppression
is intentional and has no keep-both choice. Two replacements cannot target the
same destination in one transaction.

Replace means **replace the complete incoming supported payload**, tags, folder
and favorite; this can remove destination-only fields. It requires both choosing
“update” and a separate unchecked overwrite checkbox. Changing a decision revokes
checkbox approval. The transaction saves the old ciphertext/folder/favorite in
history (`import_before`), preserves destination attachments and older history,
and preserves destination identity/creation time. Import never deletes existing
items, folders, tags or attachments. No batch delete policy is added.

Folder matching uses NFKC, trimmed, lowercased names. Reuse requires exactly one
existing match; otherwise create a separate folder. Ambiguous folder names cannot
establish exact item equality. Distinct source folder IDs remain separate when
there is no unique destination match. Unused imported folders are omitted, except
intentionally empty full-backup folders. Existing folder names are not renamed.
Tags stay encrypted within each record; skip retains old tags, keep-both preserves
each set, and explicitly approved replace takes the incoming set without union.

## Validation and privacy

Legacy JSON versions 1.0/2.0 (or unversioned supported payloads) and all five existing
vault item types have strict local shape validation. Unknown fields/types, broken
folder references, duplicate source folder IDs, malformed encrypted records and
unreadable current records block the entire review. Failures have fixed messages;
Zod issues and caught decryption/parse exceptions are not logged or rendered.
Full-backup history and attachments retain their authenticated opaque payloads;
all history/file authentication and file-size checks still run before review.

CSV preserves credential whitespace, rejects malformed quotes, duplicate headers
and unequal column counts. Supported provider mappings retain their existing
login/notes/TOTP behavior. `folder`/`grouping`, `favorite`/`fav` (0/1/false/true),
and semicolon-separated `tags` are supported. Non-login/empty rows and nonempty
unsupported columns are counted and disclosed before approval. Arbitrary provider
custom fields and extra columns are not converted; use a supported encrypted
format to preserve richer records. Alias columns use the first nonempty value.
CSV tag names cannot contain a literal semicolon. File limit is 24 MiB for CSV/
legacy JSON; existing portable-backup limits and 10,000-record bounds still apply.

Review rows expose only row number, fixed conflict category and allowed choices.
No titles, URLs, usernames, passwords, TOTP secrets, note text, card/passkey values,
plaintext identity hashes or custom-field values appear in conflict metadata.
The in-memory prepared body contains ciphertext and the existing folder metadata;
folder names remain plaintext in normal server storage/sync, as before. Keys and
portable source-account material never enter the import API. Lock/account changes
invalidate guards and clear the preview; cancellation performs no vault write.

## Atomicity, concurrency, retries and compatibility

`GET /backups/import-state` returns account-owned ciphertext/metadata under a
repeatable-read transaction and a SHA-256 digest of that encrypted state, including
folder/item IDs, timestamps, flags and history/attachment counts. This is ordinary
ciphertext sync, not a plaintext export; authentication and no-store apply.

A reviewed restore adds the state digest, opaque source/destination folder mapping,
replacement mapping and explicit overwrite flag. The server cannot verify login
identity without violating zero knowledge; it validates strict input, destination
ownership, active state, unique replacement targets and the approval flag. It
checks the reviewed encrypted state before writing inside a serializable transaction.
Stale state or a serialization conflict returns 409 and commits nothing. Existing
ordinary sync operations need no new import identity metadata or client upgrade.

Uploads use bounded, ordered, retry-safe chunks and expire after one hour. Commit
atomically writes reused/new folders, inserted/updated ciphertext, history,
attachments and the account-scoped receipt. A failure rolls everything back;
failed/abandoned upload cleanup remains bounded by expiry. Audit events contain
only the existing backup ID and receipt status, never conflict content.

Receipts additionally bind reviewed operations to a SHA-256 of the exact encrypted
request stored inside their existing JSON counts field. Public counts omit this
internal digest. Counts describe the selected source payload, including reused
folders, and exclude the newly saved overwrite-before version. A retry of the same reviewed body returns the receipt before
checking the now-changed vault; a different body with the same ID returns 409.
Concurrent identical commits have one winner; another can return a receipt or
409 and may safely retry the unchanged review. Transport retries remain bounded
and do not replay HTTP rejections. After an uncertain response, keep the same
review/decisions and retry. Changing choices requires a fresh review.

A full backup ID remains single-use per destination account. Reopening a previously
processed archive creates new randomized ciphertext/state and is rejected safely;
it cannot import portions previously skipped under that ID. Export a new archive
for a different selection. CSV/legacy reselection gets a fresh operation ID and
performs duplicate detection again; keep-both remains an explicit way to create
another differing copy. Reviews are memory-only and do not survive reload/lock;
there is no persistent resumable review. Old additive restore bodies without
review retain the preexisting no-overwrite transaction/idempotency behavior.

## Verification (6 October 2026)

Synthetic data only; API tests and the recovery drill use disposable local
PostgreSQL clusters, private Unix sockets, committed migrations and cleanup.
Focused API tests cover ownership, explicit approval, stale item/folder/trash
state, concurrent/sequential replay, different-body receipt rejection and rollback
of history/folders/content/receipt. Client tests cover encrypted equality, rename,
case-sensitive login identity, ambiguous/trash/history decisions, strict validation,
folder ambiguity/empty folders, tag handling, whitespace and secret-free errors.
Crypto tests verify randomized authenticated ciphertext and payload preservation.

Real Chromium runs the built static application with fixture-only intercepted API
requests: full-backup duplicate skip, wrong-password rejection, CSV cancellation,
no preapproval commit, disabled overwrite until separate approval, ciphertext-only
transport, password-key continuity, reload/unlock and cross-tab locking. API
atomicity is tested against real PostgreSQL separately; no live-browser production
backend or production-scale performance benchmark is claimed. A separate real
Chromium export/import check against the built production Next server and API
also passes on disposable PostgreSQL, verifying encrypted legacy JSON duplicate
skip end to end. The initial default development-server attempt failed during
existing registration/vault bootstrap before import; development startup was
not changed by P1-3. `playwright.import.config.ts` uses the production server,
requires an explicitly selected test database, supplies synthetic API secrets,
disables telemetry/traces/screenshots and refuses to reuse existing servers.
For a disposable migrated database, reproduce that check with:

```sh
VAULTMASTER_STATIC_EXPORT=0 pnpm build
VAULTMASTER_TEST_DATABASE_URL='<disposable test database>' pnpm exec playwright test --config playwright.import.config.ts
```

The synthetic test account remains only in that disposable database; destroy it
after testing. No deployment connection or production data is permitted. The
full unit/API suites additionally passed: 59 API, 92 web, 15 crypto and 72 extension
tests; three static web/proxy checks, 21 MV3 browser checks, one live-API browser
check, five audit/drill guard tests, all/prod/dev dependency gates, typecheck,
lint, static/server production builds and the isolated backup/restore drill.
Lint retains only the two existing navigation warnings; audit retains the two
existing reviewed upstream constraints. No required check remains blocked. The existing MV3
extension browser suite covers its unchanged native/import-key/sync/save paths.

Required check results are recorded in the P1-3 roadmap entry. Existing navigation
lint warnings and reviewed dependency advisory exceptions remain documented;
no new security exception is introduced. Roll back the web first if needed;
additive review support requires no database rollback. Existing ciphertext/history
and committed import receipts remain intact. P1-4 is outside this change.
