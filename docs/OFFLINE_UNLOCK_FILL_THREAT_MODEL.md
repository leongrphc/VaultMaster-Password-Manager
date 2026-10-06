# P2-4 offline unlock/fill threat model and approval decision

Decision: **BLOCKED — not approved**, 6 October 2026.
Branch: `feature/p2-4-offline-unlock-fill`. P2-4 remains incomplete. No offline
extension enrollment, unlock, fill, lease, key wrapper, API or migration is added.
This is a first-party review of the current implementation, not an independent
audit or a request to waive unresolved risks. P2-5 is outside this work.

## Assets, adversaries and acceptance rule

Protect the personal DEK, password-derived wrapping key, native authenticator PRF,
authentication hashes, session tokens, vault plaintext, passkey private keys,
exchange keys, approvals, backup keys and item/account/device bindings. Ciphertext,
URLs, account identifiers and timestamps can also reveal metadata.

Adversaries include someone copying a locked browser profile and backups; an
attacker controlling the device, browser, clock or debugger; a script executing
in the vault origin or target login page; a compromised extension publisher/update;
and an attacker replaying previously valid local state after revocation, password
change, cleanup or recovery. Consider worker suspension, crashes, multiple tabs,
network interruption and storage failures without an attacker as well.

Acceptance requires demonstrated controls and explicitly accepted residual risks
for **every** threat below, bound to the exact supported platforms, implementation
and evidence. A checkbox, successful AES authentication, browser permission,
signed package, local version number or `navigator.onLine` is not approval. Do not
exclude device compromise, compromised updates or replay merely to label this
model approved. Arbitrary executing device/browser code cannot be made safe by a
JavaScript-only key wrapper. The user has not accepted that residual risk.

## Current trust and data flows

- `packages/crypto/src/key-derivation.ts`: PBKDF2-SHA256, 600,000 iterations,
  normalized email salt, exportable AES-256 keys. This slows password guessing;
  copied wrappers/verifiers allow unlimited offline attempts without server limits.
- `vault-key.ts`: stable random personal DEK, password-key AES-256-GCM wrapper,
  random 96-bit IV, 128-bit tag and purpose AAD. Purpose binding does not bind an
  offline account/device/revision/lease. Password change rewraps the same DEK.
- Extension `vault-session.js`: DEK and tokens only in trusted in-memory session
  storage; encrypted items/metadata in `vaultmasterEncryptedCache`. Unlock calls
  `/auth/unlock`; secret retrieval re-syncs `/vault`; other requests check live
  `/auth/me`. Offline errors propagate; the persistent cache is not an authority.
  Five-minute absolute deadline, epoch checks, alarms and device-idle lock remove
  key references/items/pending work. Worker restart may retain a live session;
  browser restart/update requires sign-in. Wall time is not tamper resistant.
- Web `store.ts`, `offline-cache.ts`, `local-unlock.ts`: **pre-existing** web
  password/PRF unlock and encrypted localStorage snapshot fallback already exist.
  PRF uses native platform authentication with required UV, SHA256-derived
  nonextractable wrapping key and an encrypted base64 DEK. Hardware behavior is
  unverified in this environment. The web's script origin can access the unlocked
  DEK. Snapshot `savedAt`, wrapper versions and cleanup generations do not supply
  trusted freshness. These legacy paths are not P2-4 approval or a safe template
  for extension offline access. They remain unchanged; this gate does not claim
  to disable or certify existing web fallback.
- API auth checks a live device and refresh-reuse state even for unexpired JWTs;
  web cookies are HttpOnly/Secure/SameSite strict with exact-origin mutation
  checks. Sensitive actions consume server-side single-use, five-minute,
  account/device/operation proofs and configured MFA. No cached proof authorizes
  an offline operation. Password change revokes other devices; logout/revocation
  and device/account deletion deny subsequent online requests.
- Native extension popup/background are trusted; page messages, content scripts
  and MAIN-world passkey bridge are untrusted. Native document/frame/ancestor
  origins and protected popup approval govern delivery. Isolated JavaScript
  worlds protect variables, **not DOM field values**: page scripts can read a
  username/password once filled. Never send DEKs, vault collections, passkey
  private keys, TOTP seeds, notes or unrelated records through the page bridge.
- Web service worker caches application pages/static assets, skips `/api/` and
  RSC requests. CSP limits code and connections but does not attest a cached
  release or defeat executing same-origin code. Cached application code can be
  stale. Extension manifests grant storage/navigation/HTTP(S) sites, local code
  and API-origin connections; no clipboard/native messaging permission is added.

## Threat decisions

All candidate controls in this table are requirements, not implemented claims.

| ID / threat | Existing protection and remaining attack | Required control/evidence; decision |
| --- | --- | --- |
| device-compromise | Device/debugger can read an unlocked DEK, intercept password/PRF output and alter code/clock. JS reference clearing is not secure erasure. | Hardware-bound secret with physical UV, platform validation, short memory lifetime, and explicit acceptance of executing-host residual risk. No such verified boundary/acceptance: BLOCKED. |
| stolen-profile | Ciphertext avoids plaintext persistence, but password wrappers/verifiers are offline guessing oracles. Exportable DEK and portable backups undermine a claim of device binding. | Separate device-bound factor and domain-separated offline KEK, profile-copy tests and hardware absence denial. Native PRF capability in both extension origins is unverified: BLOCKED. |
| page-compromise | Popup/document checks stop forged approvals and cross-origin frames, not a compromised exact-origin login page. Web XSS can access web-unlocked vault state. | Exclude web-origin unlock from the candidate; never export whole-vault plaintext/keys. Selected fill secrets necessarily become page-readable. Explicitly resolve this exposure against the requested protection before allowing fill: BLOCKED. |
| malicious-update | A same-identity extension update can read its persistent storage and obtain secrets at next unlock. Signing/reproducible hashes do not make malicious authorized code safe. | Reviewed release provenance, trusted enrollment binding, reapproval after update, tested signed delivery and accepted publisher/host residual trust. Firefox signed install/update remains unverified: BLOCKED. |
| replay-rollback | GCM detects alteration, not replay of authentic old ciphertext/wrappers. Attacker can restore profile, clock and local high-water marks together. | Authenticated account/device/purpose/revision/lease transcript plus rollback-resistant state/clock outside copied profile; tamper, replay and full-profile restore tests. Local counters or signed expiry alone insufficient: BLOCKED. |
| stale-revoked-device | Offline device cannot observe server deletion/reuse, password change or account deletion. Stable DEK remains useful with captured old wrapper. | Explicit maximum revocation delay with trusted finite lease; fail closed at expiry and reconnect denial; no promise of instant remote wipe. No trusted expiry or accepted delay: BLOCKED. |
| clipboard | Web clipboard timeout is best effort; history, other applications and a stopped process retain copies. | Candidate has no copy/reveal/export/clipboard operation or permission; test denial. Narrowing is feasible but candidate not implemented: UNVERIFIED. |
| lock-timeout | Existing absolute five-minute extension deadline and epoch checks; wall-clock rollback and worker scheduling are not trusted time. | Deadline min(lease expiry, unlock + five minutes), per-operation checks, idle/device lock, no sliding extension; suspend/restart/time rollback tests. Trusted lease/deadline missing: BLOCKED. |
| multi-tab-races | Current epoch/session/document guards deny late results; web localStorage cleanup is not atomic across processes. | One background authority, serialized enrollment/wipe, durable disable generation and atomic transaction; late decrypt/write/fill, competing tabs and crash tests. Not present for offline enrollment: UNVERIFIED. |
| recovery-backup | Personal files contain DEK/items and exclude contact relationships; server restore can restore old devices/grants. Copies already delivered cannot be recalled. | Backups exclude offline leases/wrappers/consent; restore never re-enables enrollment; online fresh MFA/device enrollment after personal/server/profile recovery. Trusted generation reset and drills absent: BLOCKED. |

Threat IDs and decisions are also machine-readable in
[the gate record](offline-unlock-fill-gate.json). A passing denial regression is
not a passing approval decision.

## Narrow candidate contract (not supported or enabled)

The **currently supported P2-4 scope is empty**. A future review may consider only
personal login username/passwords on one enrolled desktop extension installation,
Chromium 127+ or Firefox 153+, after each platform's hardware and signed update
checks pass. No web app offline feature, mobile/ESR/incognito, unattended unlock,
automatic fill or dependency on the vault's own software passkeys.

Enrollment must be default-off and initiated in the protected popup while online,
with a live device, current snapshot, password plus configured MFA and a distinct
single-use operation proof. Explain stolen-profile guessing, page-visible fill,
finite revocation delay, host/update trust and wipe limits before consent. Existing
cache presence, browser installation consent, web local unlock and restored
preferences must never imply enrollment. Do not implement an opt-in toggle while
this decision is blocked.

A future offline wrapper must use a distinct random snapshot key, not persist the
live personal DEK/token, and bind version, purpose, account, native device,
extension identity/release, snapshot hash/revision and server lease in GCM AAD.
Use a separately reviewed, domain-separated KEK incorporating an independent
hardware-bound secret; specify salt, KDF parameters, PRF/HKDF context and migration
behavior in that review. Do not reuse the existing email-only password wrapper,
web PRF record or a vault-stored passkey to claim hardware binding. There is no
approved offline KDF/wrapping format in this change.

Unwrapped snapshot keys/plaintext exist only in trusted extension memory for at
most five minutes or remaining lease time, whichever is shorter. Per-operation
checks precede and follow asynchronous crypto and document delivery. Lock, idle,
logout, disable, update and enrollment change cancel all approvals and clear key,
plaintext and pending references; restart must not restore offline authority.
Avoid raw-key strings and logging. Memory clearing is best effort; browser/OS
copies and executing malware remain outside cryptographic erasure guarantees.

No approved offline lease duration exists (effective allowed duration: **zero**).
Remote revocation cannot be immediate without connectivity. A future duration
requires explicit acceptance and rollback-resistant expiry; a server signature
plus `Date.now()` does not qualify. Server revocation or any 401/403, malformed
state, expiry, clock uncertainty or storage failure must deny, invalidate local
approval and require fresh online enrollment. API failures must never silently
switch an online request to offline authority; retry cannot reuse MFA/proofs.
After reconnect, check live device, security/enrollment generation and snapshot
revision before any renewal, sync or secret operation.

A future no-network mode must be explicitly selected, show offline/last-verified
state and trustworthy expiry, and perform no API, favicon, health-provider,
telemetry, token refresh or background retry requests. `navigator.onLine` is only
a hint. API errors must leave a clear unavailable/locked state. Under the current
blocked gate, the extension's existing connection error remains the UX and no
secret operation succeeds offline. Existing web caching is a separate boundary.

If page-visible selected secrets are accepted in a later review, fill must require
fresh protected-popup selection for each item and current browser-verified exact
HTTPS origin (scheme/host/port), top-level active document, no hostname/subdomain
fallback, no forced mismatch/downgrade, no frames or closed roots, no form-action
origin mismatch, no automatic submit and no continuation across SPA navigation.
No credit cards, identities, TOTP, passkey signing/creation, password generation,
save/update, edits, trash/history/attachments, exports/imports, clipboard or health
checks offline. This stricter candidate does not loosen the online autofill rules.
A compromised matching page can still read filled fields: restrictions cannot
solve that confidentiality boundary.

Sharing/key enrollment/emergency requests/grants/open/import and sensitive actions
remain online with their existing proofs. No cached grants or exchange keys in an
offline snapshot; no offline owner grant or emergency recovery. Independently held
encrypted personal backup files are separate recovery tools, not offline leases.
Do not change their stable-DEK/file formats or server restore receipt semantics.

Future disable/wipe must work locally without network or reauthentication: deny
new operations synchronously, invalidate in-flight capabilities, lock every
extension context and then remove only offline wrappers/snapshots/leases/consent
with serialized writes. Persist a disable tombstone before async work; deletion
failure stays disabled, reports no successful wipe and permits retry. Crash,
quota failure, update and concurrent writes must never resurrect authority. Web
snapshot cleanup is not this operation. Do not bulk-clear unrelated vaults,
server data, native authenticator credentials, downloaded backups or caches.
Copied profiles/backups and flash/OS memory cannot be securely erased remotely.

## Executable gate and future approval procedure

`pnpm gate:offline` is the **approval gate** and exits 1 on this branch, including
when invoked without options. No environment variable, boolean, consent setting
or edited approval status can turn it green. Missing/malformed records, omitted
threats or altered source/model fingerprints fail closed.

`pnpm check:offline-disabled` exits 0 only when the blocked record and its pinned
runtime sources/model remain intact. It is a regression/build invariant, not an
approval. Root build, direct extension build/package (both browsers) and CI run
this check. Reviewed source-tree hashes detect additions/deletions as well as edits,
including web fallback, API authorization, crypto, manifests and cache code. Tests
exercise fail-closed policy and actual offline extension denial. The guard cannot
protect against someone deliberately replacing the guard, build system or CI;
review/branch protection and trusted release tooling remain necessary. No remote
branch-protection or signing configuration is claimed.

For a future proposal, a security reviewer designated by the repository owner must
review the exact revised model, source digests, acceptance of residual risks and
synthetic verification evidence. Every threat needs passing evidence or a clearly
accepted, justified residual boundary; no high-impact unresolved blocker can be
waived by a flag. Bind reviewer identity, approval date/expiry, scope, release and
evidence hashes in a versioned record; revoke approval on any mismatch. Replace
this blocked-only gate through that reviewed change, not an automatic pin refresh.
It intentionally has no unreviewed enablement path. Keep all online session/MFA,
reauthentication, native passkey, sharing and recovery protections.

Before any P2-4 completion claim, require focused crypto/API/extension tests;
real Chromium and stock Firefox checks (including signed updates and hardware
factor, not only mocks); replay/full-profile/clock rollback, lock/suspension,
revocation/password change, late-result/race/wipe and recovery checks; workspace
typecheck/lint/static/API builds; dependency/security gates; synthetic isolated
personal/PostgreSQL and exchange recovery drills. Archive secret-free results and
limitations against the reviewed revision. No implementation/browser/recovery
success for P2-4 is claimed here. Verification of this blocked change is recorded
separately in [the check record](OFFLINE_UNLOCK_FILL_VERIFICATION.md).

## Reviewed sources and platform references

Read before changes: current roadmap; Firefox/store/autofill policies; offline
snapshot cleanup; sensitive actions/session/device/re-authentication;
[passkeys](VAULT_PASSKEYS.md), [key exchange](CLIENT_KEY_EXCHANGE.md) and
[backup/restore](BACKUP_RESTORE_DRILL.md); crypto derivation/encryption/wrapping,
web store/offline cache/PRF/clipboard/full backup, API auth/device/reauthentication,
extension session/background/manifest/build/release policy, web CSP/service worker,
CI and relevant unit/integration/Chromium/Firefox tests.

Official references checked on 6 October 2026:
[Chrome content-script worlds](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
share the DOM despite variable isolation;
[Chrome storage](https://developer.chrome.com/docs/extensions/reference/api/storage)
and [Firefox session storage](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/session)
describe volatile session storage, not trusted hardware/anti-rollback storage.
[Firefox add-on policies](https://extensionworkshop.com/documentation/publish/add-on-policies/)
require necessary permissions, self-contained code, preserved page CSP and secure
handling; [Chrome store policies](https://developer.chrome.com/docs/webstore/program-policies/policies)
require transparent, secure user-data handling. Compliance and store review do not
supply proof against compromised publisher code or an executing hostile host.
