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
- [ ] P0-4: Finish sensitive-action reauthentication, durable abuse/rate limiting, and clear security-change notifications.
- [ ] P0-5: Add production health alerts, sync-failure observability, secret-free structured logs, and a tested deployment rollback runbook.

## P1 — first-release product completeness

- [ ] P1-1: Improve autofill for iframe and Shadow DOM forms with explicit source-origin and trust decisions.
- [ ] P1-2: Improve password-change form detection: current-password/new-password separation, generation, save/update prompts, and SPA navigation coverage.
- [ ] P1-3: Add import duplicate detection and safe conflict resolution.
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

**P0-2: repeatable isolated backup and restore drill** is complete on
`feature/p0-2-backup-restore-drill`. [Runbook](docs/BACKUP_RESTORE_DRILL.md) and
[secret-free evidence](docs/evidence/p0-2-backup-restore-drill.json) cover synthetic
v4 backup creation and chunk transfer, second-account recovery, duplicate retries,
injected transaction failure with unchanged before/after state, PostgreSQL dump
recovery into a second database, and cleanup. Repeated local drills, 5 backup API
regressions, 2 isolation guard tests, 14 crypto tests and 74 web tests passed;
frozen-lockfile install, typecheck, lint and static build passed (3 existing lint
warnings). No production data or credentials were used. P0-3 was not started.
