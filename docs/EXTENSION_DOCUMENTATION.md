# P1-6 extension documentation and terminology

Scope: documentation and literal UI copy only, on
`feature/p1-6-extension-docs-terminology`. P1-7 remains unstarted.

The [glossary](TERMINOLOGY.md) defines English documentation and Turkish UI terms.
The [extension guide](../apps/extension/README.md) covers setup, permissions,
trust/origin limitations, iframe/Shadow DOM policy, password changes, import/export,
health privacy, troubleshooting and release/update steps. Popup/web Settings link
to the guide; Settings also links the glossary and ZIP checksum. The
[release checklist](EXTENSION_STORE_PREPARATION.md), [deployment guide](../DEPLOYMENT.md)
and security records link back to this vocabulary and current user guidance.

Copy distinguishes sign-in from unlock, saved login from item, approved fill from
site submit, new-item save from password update, and import replacement from a
field merge. The old README's suggestion that HTTPS downgrade could be confirmed
was incorrect; it now states the existing unconditional rejection. No security
semantics, handlers, host rules, permissions, API, encryption or storage behavior
changed. Manifest identities/versions and migration formats are unchanged.

## Limitations

Historical feature verification records retain their original test counts and
scope. Protocol identifiers/browser-owned labels and account-registration wording
are not renamed. There is no separate extension options page or extension file
import/export/health UI. Guide links point to this review branch on GitHub, so they
require network/GitHub access and should move to the retained release branch when
merged. Local checks validate repository destinations; external reference uptime
and hosted CI are not certified by them.

Chrome is automated; manual Edge, store identity assignment, publication assets/
legal review and real store-delivered updates remain external prerequisites.
Version 1.3.0 is a local candidate; no store upload, publication, production deploy,
live HIBP check or independent audit is claimed. Custom/ambiguous forms, closed
roots/foreign frames, online extension requirements, transient save-prompt page
trust, cross-client update race and health-prefix privacy limits remain documented
in the guide and their security policies.

## Verification

Baseline before edits: 74 extension and 100 web tests passed, using synthetic data.

Final local verification on 6 October 2026 (Node 26.10.0, pnpm 9.15.0):

- Four documentation checks passed: glossary/guide coverage, repository files and
  heading links, UI guide destinations/terminology, and copy/secret safety.
- 74 extension unit tests, 100 web tests and 17 crypto tests passed. Web tests used
  `NODE_OPTIONS=--no-experimental-webstorage` for this local Node version.
- All 22 real Chromium extension checks passed, including sign-in, lock/unlock,
  password generation/update, iframe/Shadow DOM trust, HTTPS downgrade rejection,
  worker restart and in-place release update. Three stale lock/unlock test
  selectors found on the first run were corrected to the new labels; the full
  rerun passed. Three static web/proxy Chromium checks passed, including import
  overwrite approval, health cancellation and session security.
- Workspace lint and typecheck passed. Lint retains the two existing Next.js
  navigation warnings. Changed extension JavaScript passed `node --check`;
  `git diff --check` passed.
- `NODE_ENV=production VAULTMASTER_STATIC_EXPORT=1 pnpm build` passed for all
  five packages, including static web security headers and extension downloads.
  Two serially packaged extension ZIPs matched byte for byte; archive verification
  passed with identity `cajnckjhhpbgephllmoaceolbifmnkoa` and version 1.3.0.
- Three dependency-audit policy tests and two backup-drill isolation guard tests
  passed. All/prod/dev dependency review reported zero unreviewed findings;
  the critical-advisory gate passed. The two previously reviewed high advisories
  remain within their existing exceptions; no dependency policy was changed.
- Playwright discovered all three database-backed E2E tests with the updated
  selectors. Those tests, API integration tests and the full recovery drill were
  not rerun for this documentation/copy change; no database/API behavior changed.

No required P1-6 local check remains blocked. CI retains Node 22; hosted CI,
manual Edge and external store/provider checks are not represented by these local
results. P1-7 remains unstarted.
