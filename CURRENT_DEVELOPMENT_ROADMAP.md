# VaultMaster — Current Development Roadmap

Updated: 6 October 2026
Base branch: `fix/extension-navigation`

This roadmap replaces the older `DEVELOPMENT_ROADMAP.md` as the working priority list. Each completed feature must be independently tested, committed, pushed, and verified on GitHub before the next feature begins.

## Current baseline

The active branch already includes client-side AES-256-GCM vault encryption, PBKDF2-SHA256 key derivation, Argon2id authentication hashing, TOTP/recovery codes, WebAuthn login, HttpOnly web sessions, same-origin API proxying, CSP, device-bound sessions, encrypted full personal backups, secure extension autofill, CI, browser tests, and production deployment documentation.

## P0 — reliability and production safety

- [x] P0-1: Extend encrypted personal backups beyond the current 16 MiB snapshot / 24 MiB file limit with a versioned chunked or streaming format.
- [x] P0-2: Add a repeatable production backup and restore drill with documented rollback evidence, without using real user data.
- [x] P0-3: Complete dependency vulnerability review; separate actionable production/runtime findings from development-only findings and document decisions. [Review and follow-ups](docs/DEPENDENCY_VULNERABILITY_REVIEW.md), [secret-free evidence](docs/evidence/p0-3-dependency-audit.json): 82 baseline advisory records reduced to 2 upstream CLI/lint constraints, with weekly review and exceptions expiring 5 November 2026. Repeatable all/prod/dev CI gates added; 185 unit/integration tests, 3 audit-policy tests, typecheck/lint/static build and Chromium web/extension checks passed. P0-4 remains untouched.
- [x] P0-4: Finish sensitive-action reauthentication, durable abuse/rate limiting, and clear security-change notifications. [Policy, deployment and limitations](docs/SENSITIVE_ACTION_SECURITY.md): five-minute single-use account/device/operation proofs with configured MFA; PostgreSQL-backed account/IP limits and secret-free security inbox. Encryption and session effects preserved; verification below.
- [ ] P0-5: Add production health alerts, sync-failure observability, secret-free structured logs, and a tested deployment rollback runbook.

## P1 — first-release product completeness

- [x] P1-1: Improve autofill for iframe and Shadow DOM forms with explicit source-origin and trust decisions. [Policy, verification and limitations](docs/ADVANCED_AUTOFILL_SECURITY.md): same-origin ancestor chains and open Shadow DOM login forms; browser-verified document/frame sources and protected extension-popup selection. Cross-origin/opaque frames and closed roots explicitly unsupported; Chrome 127+. 60 extension and 82 web tests, 12 real Chromium extension checks, three web/proxy checks, typecheck, lint and static build passed. No production deployment; P1-2 remains untouched.
- [x] P1-2: Improve password-change form detection: current-password/new-password separation, generation, save/update prompts, and SPA navigation coverage. [Policy, verification and limitations](docs/PASSWORD_CHANGE_AUTOFILL.md): conservative field roles, protected 24-character generation, trusted-submit encrypted drafts, explicit create/update approval with resync conflict checks, and browser-verified SPA routing. 72 extension and 82 web tests, 21 real Chromium extension checks, three web/proxy checks, typecheck, lint and static build passed. Ambiguous/custom forms and atomic cross-client write conflicts remain documented limitations; no production deployment. P1-3 remains untouched.
- [x] P1-3: Add import duplicate detection and safe conflict resolution. [Policy, verification and limitations](docs/IMPORT_CONFLICT_RESOLUTION.md): client-only deterministic duplicate review for CSV, legacy encrypted JSON and v3/v4 full backups; explicit skip/keep-both/update decisions, separate overwrite approval, encrypted before-history, owned folder reuse, stale-state rejection and atomic receipt-bound retries. 59 API, 92 web, 15 crypto and 72 extension tests passed; three static Chromium web/proxy checks, one real API/PostgreSQL Chromium import check and 21 MV3 checks passed, plus typecheck, lint, static/server builds, dependency/security gates and the isolated recovery drill. History/attachment conflicts are skip/keep-both only; full-backup IDs remain single-use; development-server vault bootstrap failure is documented with a passing production-server browser configuration. Two existing lint warnings and reviewed advisory constraints remain. No production deployment; P1-4 remains untouched.
- [ ] P1-4: Add health-report progress, cancellation, and privacy explanations.
- [ ] P1-5: Complete extension store preparation: permissions review, stable store identity, update path, ZIP reproducibility, and installation checklist.
- [ ] P1-6: Expand extension documentation and make UI terminology consistent.
- [ ] P1-7: Evaluate self-hosted fonts and offline snapshot cleanup UI.

## P2 — later scope

- [ ] P2-1: Implement real passkey registration/signing for vault-stored passkeys.
- [ ] P2-2: Implement client-side key exchange for sharing and emergency access.
- [ ] P2-3: Firefox support.
- [ ] P2-4: Offline unlock/fill, only after its threat model is approved.
- [ ] P2-5: Independent security review, threat model, security policy, release runbook, and versioned changelog.

## Working rules

1. Work from `fix/extension-navigation` unless a feature branch is explicitly required.
2. Do not use the obsolete roadmap as the priority source.
3. Before changing code, inspect the active branch and run the smallest relevant baseline tests.
4. One feature at a time. Do not mix unrelated fixes.
5. Every completed feature requires focused tests, relevant typecheck/build/lint checks, a commit, a push, and remote verification.
6. Never claim a feature is complete when a required check was not run.
7. Never use production user data for tests; use disposable or isolated databases.
8. Preserve existing encryption formats and migration compatibility unless the feature explicitly includes a versioned migration.

## Latest completed feature

**P0-4: sensitive-action security** is complete on
`feature/p0-4-sensitive-action-security`. The
[security record](docs/SENSITIVE_ACTION_SECURITY.md) defines the shared API/web
policy, native-client upgrade contract, rate budgets, notification delivery,
privacy boundaries, maintenance SQL and rollback effects. Apply migration
`20261006020000_sensitive_action_security` before the API, then update the web.
No production deployment or independent security audit is claimed.

Verification on 6 October 2026, using synthetic data only:

- 56 API tests passed, including 9 focused P0-4 tests, real signed WebAuthn login
  and reauthentication, concurrent proof/recovery replay, expiry/scope binding,
  fresh-process durable budgets, storage failure, notification rollback,
  ownership, session revocation and web deletion/CSRF/cookie effects.
- 82 web tests, 14 crypto tests and 50 extension tests passed. Eight focused web
  tests cover approval, MFA/failure, cancellation/lock races, HTTP rejection
  without replay/logout, cookie-only requests and notification acknowledgement.
- Three Chromium web/proxy checks and one real MV3 extension check passed.
  Password-change/backup reauthentication preserves the stable data key,
  reload/unlock, cross-tab locking and cookie-refresh coordination.
- The isolated backup/restore drill passed with all 19 public tables matching
  after recovery and verified cleanup. All six migrations applied to a second
  empty local PostgreSQL database; Prisma schema comparison reported no drift.
- Typecheck, lint and static production build passed. Lint retains two existing
  navigation warnings. Five audit-policy/drill-isolation guard tests passed.

Documented limitations: notifications are in-app (latest 50, refreshed every
30 seconds), not email/push; exports record approval/preparation rather than OS
file-save completion; expired-row cleanup must be scheduled by the operator.
Existing immediate signup can still reveal duplicate-registration availability;
email-verification/enrollment redesign is not included. Existing WebAuthn
challenges restart on process loss, while accepted proofs and limits are durable.
Already-unlocked client plaintext and ordinary ciphertext sync cannot be protected
by an explicit export confirmation. Full scope, client compatibility and rollback
risks are in the security record. No required local check remains blocked.

P0-5 and all P1/P2 work remain unstarted by this feature.
