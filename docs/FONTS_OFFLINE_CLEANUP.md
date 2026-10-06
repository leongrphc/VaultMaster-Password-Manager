# Fonts and offline snapshot cleanup (P1-7)

Scope: web typography and removal of the encrypted local snapshot only. No P2
work, production deployment, encryption migration, offline extension unlock/fill,
server deletion or backup cleanup is included.

## Font decision

Use `system-ui, sans-serif` for body/display and `ui-monospace, Consolas,
monospace` for codes. Remove the remote Fontshare stylesheet and its CSP hosts.
No font binary, license file, dependency or build-time download is added. Font
payload is zero bytes; layout and glyph appearance vary by operating system.

Previously, the root layout fetched Cabinet Grotesk (400/500/700/800) and Satoshi
(400/500/700) through Fontshare. Their cross-origin CSS/fonts escaped the
same-origin service-worker cache; first offline visits and provider failures used
the existing system fallback. Requests also disclosed ordinary connection
metadata to a font provider. Fira Code was named but never loaded.

The official [Satoshi](https://www.fontshare.com/fonts/satoshi) and
[Cabinet Grotesk](https://www.fontshare.com/fonts/cabinet-grotesk) family pages
identify both as closed-source ITF families. The official [Fontshare license](https://www.fontshare.com/licenses/itf-ffl)
was read in Chromium on 6 October 2026 (the text-only reader returned a JavaScript
shell). ITF FFL version 2.0, dated 17 August 2026, permits self-hosting on the
licensee's own websites/applications. It restricts redistribution through
repositories and modifications including subsetting/conversion. Do not treat
these fonts as SIL OFL or vendor provider CSS/binaries without their exact source,
version, checksum and corresponding license. Self-hosting for our own deployment
is technically possible, but distributing the fonts in this repository needs a
separate rights decision. No redistribution permission is assumed here.

Installed Next 16.3.8 font/static-export guides support local files through
`next/font/local`. Such files could become same-origin static assets permitted by
`font-src 'self'` and cached under `/_next/`, with a nonzero per-file transfer and
cache cost. No files were downloaded, so no measured font-size or performance
claim is made. System fonts meet privacy/offline goals with less deployment and
licensing work; preserving the previous branded typography is not necessary for
P1-7. This is a decision against adding fonts, not a claim self-hosting is
technically unsupported or universally prohibited. Future branded fonts require
verified file metadata and repository redistribution rights, Turkish glyph/weight
checks, byte measurements and a new review.

Static export continues to generate exact script hashes; font CSP permits self
only, styles retain existing inline styling permission. No encryption, session,
reauthentication or API policy changes accompany typography.

## Cleanup contract

Settings → Genel → Çevrimdışı Kopyayı Temizle explains the scope before opening
an accessible confirmation. Cancel, Escape, navigation/unmount, lock and account
changes abandon approval. Confirmation consumes approval synchronously, checks
the existing vault session guard and removes only
`vaultmaster-offline-snapshot`. A second confirmed action is harmless. Presence
checks do not parse/decrypt the envelope or render vault metadata.

Retained intentionally:

- Server vault items, folders, trash, history and attachments: authoritative data.
- Downloaded backup files, import/restore state, receipts and staged server
  transfers: separate recovery/transaction state; no API request is made.
- Authentication, encrypted lock verifier and local authenticator record: cleanup
  does not change sign-in/unlock semantics.
- Currently loaded plaintext items: cleanup does not lock or mutate the vault.
- Service-worker app/page caches, other storage keys and other origins: required
  app assets and unrelated state are outside this action.

The encrypted snapshot is a convenience copy of loaded personal items/folders,
not a complete portable backup. Removing it eliminates that browser copy's
fallback data. Normal later sync or edits may recreate it; this is not an opt-out
or permanent ban on snapshots. The status checks only presence, not ownership,
completeness or decryptability. It does not show sizes, titles or secret fields.
Last-sync time and current offline-data status still describe the loaded vault;
they do not assert a retained disk snapshot.

An opaque `vaultmaster-offline-snapshot-generation` marker invalidates encryption
started before cleanup, including writes in another tab that observe the marker
before their final write. It contains no account or vault data. A generation
write/storage failure produces fixed UI text, consumes the approval and permits a
fresh retry; failed deletion never claims success. Snapshot ciphertext/IV format
and existing cryptographic checks remain unchanged.

Limitations: localStorage has no cross-tab compare-and-swap. A concurrent write
between the generation check and final storage write in another process can
race, and a new sync can recreate a snapshot. This is scoped best-effort local
removal, not secure erasure, cross-device revocation or a storage lockdown. Browser
backups, devtools, copied ciphertext and OS/browser memory are not erased. Other
origins/profiles must be handled separately. Service-worker cache retention and
its existing lifecycle are unchanged; this UI does not promise to clear caches.
Previously cached release pages can retain old font references until a successful
network refresh; this feature does not purge older application releases.
Caught storage errors are not logged, sent to telemetry or rendered verbatim.

## Verification

Focused unit tests and real Chromium static-export checks cover font fallback,
no Fontshare loading, blocked external font CSP, offline system rendering,
confirmation/cancel/Escape, repeat removal, navigation/unmount, lock/account
invalidation, storage-error recovery, retained keys and secret-free UI. Persistence
unit tests use real WebCrypto for encrypted writes and delayed-write generation
checks.
The browser suite uses synthetic API fixtures and passwords; no production data,
telemetry upload, screenshots or traces are used.

Passed on 6 October 2026:

- 109 web tests (11 focused persistence/UI tests), 17 crypto tests and 74 extension
  tests; four documentation gates, three dependency-policy tests and two recovery
  drill isolation guards.
- Three static Chromium web/proxy checks, including the new P1-7 cases and existing
  password change, backup/import, reauthentication, health and cross-tab security.
- Workspace typecheck, lint and production static build/export with generated CSP.
- All/prod/dev dependency review and critical audit gate; no unreviewed finding.
- Isolated backup/restore drill with synthetic PostgreSQL data, encrypted portable
  recovery, matching 19 public tables and cleanup. Evidence is generated under
  `test-results/backup-restore-drill.json`, not production data.

Reproduce using the root package scripts: `pnpm lint`, `pnpm typecheck`,
`NODE_OPTIONS=--no-experimental-webstorage pnpm --filter @vaultmaster/web test`,
crypto/extension workspace tests, `VAULTMASTER_STATIC_EXPORT=1 NODE_ENV=production
pnpm build`, `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 pnpm test:web:browser`,
`pnpm test:dependency-audit`, `pnpm audit:dependencies`, `pnpm audit
--audit-level=critical`, `pnpm test:docs`, `pnpm test:backup-drill-safety` and
`pnpm drill:backup-restore`.

Two existing navigation lint warnings and two reviewed upstream advisory records
remain. Vite config-loader and Sentry configuration deprecation notices remain.
No required local check is blocked. Browser tests do not claim Firefox/Edge,
production deployment, real-provider availability or an independent audit.
Rollback requires only previous web assets; there is no database change. The
opaque generation marker may remain harmlessly after rollback.
