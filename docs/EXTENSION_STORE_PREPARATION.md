# P1-5 extension release preparation

Terminology: [shared glossary](TERMINOLOGY.md). User steps and current combined
limitations: [extension guide](../apps/extension/README.md). Historical verification
sections below describe their original feature scope.

Prepared on `feature/p1-5-extension-store-prep`, 6 October 2026. Version 1.3.0
is a local release candidate. No store upload, publication, production deployment,
store approval, automatic update delivery or independent audit is claimed.
The P1-6 [documentation record](EXTENSION_DOCUMENTATION.md) covers current user guidance.

## Permission review

| Retained capability | Required use and boundary |
| --- | --- |
| `storage` | Ciphertext/preferences in local storage; tokens, DEK and encrypted short-lived drafts in trusted session storage. Session access remains `TRUSTED_CONTEXTS`; no plaintext credentials persisted. |
| `contextMenus` | User-invoked login/fill menu opens protected extension selection UI. It cannot authorize a secret by itself. |
| `alarms` | Minute session/badge checks enforce the five-minute absolute lock deadline alongside per-request expiry checks. |
| `idle` | Device lock events lock the vault; no user activity history is collected. |
| `webNavigation` | Browser-verified frame/document/ancestor origin checks and SPA approval invalidation; removing it would weaken the fail-closed security policy. No browsing history is stored. |
| `http://*/*`, `https://*/*` host access | Cross-origin API fetch, HTTP(S) tab URL queries and arbitrary user-chosen login sites. Broad HTTP(S) access is retained explicitly because persistent detection, trusted-submit save capture and navigation-continuation operate before/after toolbar invocation. `activeTab` alone would not preserve these flows. Browser site-access controls can restrict access; unsupported/withheld documents fail closed. |
| HTTP(S) content-script matches, `all_frames` | Discover login forms in top-level pages and same-origin frames; runtime ancestor policy rejects cross-origin/opaque frames. No origin fallback injection. |
| HTTP(S) top-level MAIN-world `passkey-injected.js` | Public WebAuthn ceremony bridge; creation/signing requires unlocked vault and protected popup approval. No extension API or vault key is exposed. See [supported subset](VAULT_PASSKEYS.md). |

Removed `tabs` and `activeTab`: HTTP(S) host grants already provide the tab URL
properties used by this implementation. Removed `<all_urls>` and redundant
loopback entries; file/FTP access is unnecessary and unsupported. No scripting,
cookies, clipboard, downloads, webRequest, native messaging, external messaging,
optional grants or permission escalation is introduced. Host access still triggers
broad site-access warnings; do not describe the extension as limited to one site.
The extension CSP permits local scripts only and network connections only to the
configured API origin. API environment secrets are never build inputs.

References: [Chrome tab permission semantics](https://developer.chrome.com/docs/extensions/reference/api/tabs),
[activeTab lifetime](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab).
The [autofill policy](ADVANCED_AUTOFILL_SECURITY.md) and
[password-change policy](PASSWORD_CHANGE_AUTOFILL.md) remain authoritative.

## Stable identity and update contract

The existing public SPKI `manifest.key` stays committed and derives unpacked ID
`cajnckjhhpbgephllmoaceolbifmnkoa`; build/package tests pin it. It is not a signing
private key. Version 1.3.0 matches package metadata and supersedes the repository's
1.2.0 manifest and documented deployed 1.1.0. Every future released update must
increase the numeric manifest version, including rollback releases. Do not rotate
the key to ship an update. There is deliberately no self-hosted `update_url`, CRX
signing implementation or automatic update claim for the downloadable ZIP.

A store-assigned identity cannot be guaranteed by the existing public key.
Before initial Chrome submission, the operator must create/inspect a dashboard
item without publishing, obtain its public key/ID and compare with the pinned ID,
following [Chrome's identity instructions](https://developer.chrome.com/docs/extensions/reference/manifest/key).
If the assigned ID differs, treat it as a separate installation: explicitly review
and commit the chosen public key and policy pin, add that exact extension origin to
`WEBAUTHN_EXTENSION_ORIGINS` before release, verify CORS/WebAuthn and perform a fresh
login. Never wildcard the origin or promise automatic storage/session migration.
Edge Add-ons requires its own dashboard identity verification and exact API origin
allowlist; Chromium testing here does not certify Edge store acceptance.

After initial publication, upload increasing versions to the **same dashboard
item**; the store handles signing and update delivery. The public ZIP is a manual
unpacked install/update channel, not a store auto-update feed. Keep its directory
and public key stable, replace contents then Reload; reinstalling/removing can lose
local preferences/ciphertext. Reload/update/disable clears trusted session state,
so fresh login is expected. Persistent ciphertext remains server-backed; no vault
format or database migration is introduced. Worker restart is different from a
full extension update and may retain an unexpired trusted session.
Rollback uses reviewed compatible code under a higher version for store clients;
for unpacked clients replace in place and reload. Never revert to weaker autofill
source/approval boundaries just to recover packaging. If compatibility is uncertain,
disable the extension while preparing a corrected release; do not reset vault data.

## Reproducible packaging and verification

Use the committed lockfile, pnpm 9.15.0 and Node 22, same OS/runtime and origins.
The crypto dependency must be built first. Both local and static-web packaging use
the same script. For a review candidate (these are public origins, not secrets):

```sh
pnpm install --frozen-lockfile
pnpm --filter @vaultmaster/crypto build
export VAULTMASTER_APP_URL=https://vaultmaster.mozkan.com.tr
export VAULTMASTER_API_URL=https://vaultmaster-api.onrender.com/api
pnpm --filter @vaultmaster/extension build
pnpm package:extension test-results/extension-first.zip
pnpm package:extension test-results/extension-second.zip
cmp test-results/extension-first.zip test-results/extension-second.zip
sha256sum test-results/extension-first.zip test-results/extension-second.zip
pnpm verify:extension test-results/extension-first.zip
```

ZIP entries sort by byte-compatible ASCII order, use fixed 1980-01-01 timestamps,
fixed headers/attributes and raw DEFLATE without filesystem metadata. Each run
rebuilds an isolated staging directory rather than reusing `dist`; staging is
removed even on failure. Runs are serial because the fixed staging directory is
shared. Byte equality is promised for identical built inputs/toolchains, not across
Node/zlib/compiler versions. No build time, absolute source path or machine identity
is embedded. `verification.json` lists every runtime file's size and SHA-256,
version and derived identity (it excludes itself to avoid self-reference).
`<zip>.sha256` covers the entire archive including inventory. The verifier checks
checksum, local/central entries, allowlist, inventory, identity and permissions.
Checksums detect changes; they are not signatures or proof of publisher authenticity.

Only ten named source runtime files and six named compiled crypto files can ship.
Source maps and their directives, `.env`, private keys, fixtures, tests, dependencies,
editor files and local artifacts are excluded. The package gate also rejects known
private-key/token patterns and source-map references. This is defense in depth,
not an exhaustive secret detector: review the actual inventory and source diff.
The manifest identity key is intentionally public. The static web download generates
both ZIP and checksum; its contents still depend on the configured build origins.

## Installation, update and submission checklist

1. Record commit SHA, numeric version, Node/pnpm versions, public build origins,
   ZIP SHA-256 and inventory. Compare two fresh archives and run verification.
   Reject wrong origins, mismatched identity/version, maps or unexpected files.
2. Use a disposable browser profile and synthetic account. Chrome 127+ is required;
   verify Edge 127+ manually before an Edge release. Extract the verified ZIP to a
   stable directory; Load unpacked at `chrome://extensions` or `edge://extensions`.
   Verify ID/version, permission warnings and absence of manifest/worker errors.
3. Pin/open popup; sign in with configured MFA, lock/unlock, fill a controlled HTTPS
   login and HTTP fixture, test new-password generation and explicit password update.
   Verify foreign/opaque frame rejection, HTTPS downgrade denial and API failure
   denial. Browser-restricted pages and file URLs are unsupported.
4. Test site access withheld/re-enabled in browser controls; reloading the target
   may be necessary. No granted access means no detection/fill. Verify there is no
   fallback secret delivery. Do not enable file access or incognito for this release.
5. Update the **same unpacked directory** from the previous reviewed build without
   removing the extension; reload and verify unchanged ID, increased version,
   preferences/ciphertext retention, session cleared/fresh login, then autofill.
   Restart the browser and check fresh login again; worker restart tests separately
   verify the limited session-memory behavior. Store-managed upgrades require
   dashboard/test-channel verification once an actual store item exists.
6. Before submission, verify exact dashboard ID/key and API allowlists. Prepare
   store-required icons/screenshots, single-purpose description, privacy policy URL,
   support contact, data-use/permission declarations and reviewer test instructions.
   Explain client-side encryption, broad HTTP(S) access, API traffic, transient drafts
   and the supported passkey subset/UV limitations honestly. Check current dashboard
   requirements; store assets/legal URLs, operator account and review are external
   publication prerequisites, not completed by this code change.
7. For later store updates, upload only to the existing item, increase version,
   review any permission warning changes, verify upgrade in its available test
   channel, then obtain publication approval through the operator's release process.
   Save store evidence separately; do not claim publication from a local ZIP build.

## Verification record and limits

Local checks and final digest are recorded below. No live store
account, production user data or live deployment is used. Initial packaging checks
caught compiled crypto source-map directives; the build now strips them while
omitting the maps. Real Chromium automation covers HTTP(S) permission reduction,
identity and existing consent/frame/session policies. Manual Edge, actual store
install/auto-update, publisher assets/legal review and dashboard identity assignment
remain release prerequisites. These external publication limits do not block local
store preparation; they must block any assertion that this candidate is published.

Final local verification (Node 26.10.0, pnpm 9.15.0; CI is configured for Node 22,
whose hosted result is not claimed here):

- 74 extension unit/package tests passed; baseline was 72. Policy tests reject
  identity/permission/injection changes, unsafe CSP, unexpected files, key/map
  markers and corrupted archives; two clean rebuilds compare byte for byte.
- 22 real Chromium extension checks passed, including existing signed WebAuthn,
  protected fill/save/generation, same-origin/foreign/opaque frames, Shadow DOM,
  SPA invalidation, phishing, HTTPS downgrade, locks and worker restarts. The new
  synthetic 1.3.0 → 1.3.1 in-place replacement **with browser restart** preserves
  ID and local preferences/ciphertext, clears session memory and permits fresh
  login/logout. It does not simulate a store-delivered CRX upgrade or live Reload.
- Workspace typecheck and lint passed; lint has two existing Next navigation
  warnings. Extension JavaScript has no dedicated TypeScript/lint task; all 17
  extension source/build/test and release-script JavaScript files passed syntax checks.
- Static workspace build passed, including web download ZIP/checksum generation.
  Three additional web/proxy browser checks passed after a stable build. An initial
  run overlapping static-output regeneration failed to find its vault fixture;
  rerunning after the build resolved it. Build and browser serving must be sequential.
- Three dependency-audit policy tests, all/prod/dev reviewed dependency gates and
  critical audit gate passed. Two previously reviewed high advisory constraints
  remain under the existing exception policy; no new exception was introduced.
- Release-origin ZIPs generated twice compare exactly, pass the inventory/checksum
  verifier, and pass independent Python zipfile CRC/timestamp checks (17 entries).
  `unzip` is unavailable on this host; Python provided the independent archive check.

Release-origin ZIP SHA-256 (both runs):
`028b22f906725bcbf59b10bdf9f6d6d543e7367978994ff9968009847725cb15`.
Origins used: `https://vaultmaster.mozkan.com.tr` and
`https://vaultmaster-api.onrender.com/api`. This digest identifies this locally
built candidate, not the existing production download. No required local check
remains blocked; store identity assignment, operator submission materials, manual
Edge verification and store delivery are explicitly unverified external steps.

Additional verification commands:

```sh
pnpm --filter @vaultmaster/extension test
pnpm typecheck
pnpm lint
VAULTMASTER_STATIC_EXPORT=1 pnpm build
PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 pnpm test:extension:browser
PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 pnpm test:web:browser
pnpm test:dependency-audit
pnpm audit:dependencies
pnpm audit --audit-level=critical
```

The Playwright platform override selects installed Chromium on this Ubuntu 26.04
host. Run packaging/tests serially; they share the staging directory. CI now
compares two ZIP builds and verifies their inventory/checksum before tests. CI
execution and any future publication must be verified separately.
