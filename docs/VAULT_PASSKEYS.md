# Vault passkeys (P2-1)

Implemented on `feature/p2-1-passkey-registration-signing`. This record describes
a software authenticator with real ES256 registration and assertion signatures.
It does not claim platform key export, OS synchronization, hardware attestation,
biometric verification, FIDO certification or an independent security audit.

## Use and supported ceremonies

Sign in to the extension and unlock its vault first. On a supported website,
start its passkey creation/sign-in action. The page notice directs you to the
extension icon. The protected extension popup shows the browser-verified origin,
RP ID and requested registration account, or matching stored accounts. Explicitly
choose **Passkey Oluştur ve Şifreli Kasaya Kaydet** or **İmzala**. Cancel in the
popup or page notice; the site's AbortSignal and timeout also cancel the request.
No page click or page message can authorize creation/signing. Pages receive no
candidate list, vault titles, private keys, approval IDs or account availability.
No-match, locked, expired and cancelled supported requests fail generically.

The initial supported subset is top-level HTTPS (localhost/127.0.0.1 HTTP for
local testing), RP ID exactly equal to the hostname, ES256/P-256, none attestation,
discoverable credentials, optional allow/exclude lists and registration
`credProps`. Discoverable account choice happens only inside the extension.
Origins also bind scheme and port. Parent-domain RP IDs, related origins,
iframes, conditional/silent mediation, required user verification, requested
authenticator attachment, other algorithms/attestation and other extensions (including
PRF) use the original native browser path; vault keys cannot satisfy those
requests. A native browser may therefore still show its authenticator dialog.
Unknown native options and native authenticator capabilities are not advertised
as vault capabilities. Support has been checked in Chromium, not manually in
Edge or Firefox. Sites using saved native methods, WebIDL brand checks or their
own credential wrappers may bypass/reject the compatibility wrapper. This is
not a claim of full WebAuthn client conformance or universal site compatibility.

The configured VaultMaster web origin always uses native WebAuthn for account
MFA and PRF local unlock. Those native private keys cannot be exported into the
vault. A third-party vault passkey cannot unlock its own encrypted vault. Keep
an independent login/recovery method for the vault and for each relying party.
Manual Add Item passkey fields retain legacy import compatibility; arbitrary
legacy private-key strings do not become signing credentials. Generated key
bindings are immutable in the web editor; title, username display, notes, tags
and folder can still be changed. Trash/deletion removes a credential from active
selection; it does not revoke that credential at its relying party.

## Encrypted format and authenticator behavior

Existing `VaultItemPasskeyData` and AES-256-GCM item encryption are retained.
`privateKey` is an opaque string beginning `vm-passkey-v1:` followed by a JSON
envelope containing base64url PKCS#8 P-256 private material and immutable origin,
RP ID, random 32-byte credential ID, relying-party user handle and COSE public
key bindings. `publicKey` contains base64url CBOR COSE EC2/ES256; `userHandle` is
the RP-provided user ID (1–64 bytes); `credentialId` is random, never an email or
account-derived identifier. These fields, titles and usernames all live inside
the encrypted item. The API receives ciphertext/IV and existing item metadata,
never the signing key, envelope, decrypted content or site challenge. The item
uses the existing stable vault data key and password-wrapped key envelope.
Password changes rewrap that data key; ordinary encrypted sync and existing
personal backup/restore retain signing capability across unlocked clients.
There is no platform/OS synchronization integration.

WebCrypto generates the key on the unlocked client; extractability is used only
to serialize it into the encrypted item. Signing imports PKCS#8 as a
nonextractable key. No signing key is sent over the page/content bridge or stored
in persistent plaintext storage. The extension's existing trusted-only in-memory
session storage holds its unlocked DEK until the absolute five-minute deadline;
lock, logout, browser reload/update and device lock enforce the existing policy.
JavaScript/browser memory is not guaranteed to be securely erased.

Responses use `webauthn.create`/`webauthn.get`, exact challenge/origin,
`crossOrigin: false`, SHA-256 RP hash, a zero AAGUID, CBOR none attestation and
DER-encoded ES256 signatures over authenticator data plus SHA-256 client data.
UP is set only after protected popup approval. UV is never set: an unlocked
vault plus approval is not represented as a new user-verification ceremony.
BE is set because this credential is portable through encrypted vault recovery;
BS is unset because no secondary authenticator replica/backup state is verified.
The signature counter is always zero; concurrent clients/restores cannot safely
maintain a shared increasing counter. This is an allowed authenticator behavior,
not evidence of clone detection. No hardware attachment or transport is asserted.

The MAIN-world document-start wrapper uses normal `navigator.credentials`
creation/assertion calls and returns compatible response objects with byte
buffers, public SPKI/accessor methods and JSON serialization. Isolated content
scripts only relay public ceremony inputs/results. Chrome supplies tab,
document, frame and origin identity; page-supplied origins must match it exactly.
The protected popup alone obtains a random approval capability. Approval is
consumed before key operations and binds the live vault session/epoch, document,
operation and 60-second deadline. Document/active-tab and live API device checks
run before and after work. Lock/session change suppresses returned responses;
worker restart clears pending approvals and requires a new site request, while
an unexpired existing unlocked session can resume normal work. Pending public
responses are volatile and are removed on delivery, cancellation or lock.

## Verification responsibilities and failure behavior

A third-party RP must issue and consume its own unpredictable, expiring,
account-bound challenges and verify registration/authentication server-side,
including origin, RP hash, presence, UV policy, credential ownership, signature
and duplicate credential policy. The extension cannot authorize a site's account
or enforce a remote site's replay policy. It never uploads private material to
an RP. Registration returns only after the encrypted item has been saved and
resynchronized. If the RP rejects registration, or cancellation/navigation wins
after a ciphertext write, an unused encrypted item can remain; remove it after
checking the RP. Cancelling cannot recall an already accepted HTTP write or
server response. Conflicting restored copies of the same credential ID are
refused for signing; identical copies require explicit selection and use the
same zero-counter credential. Exclude lists reject existing active credentials
without exposing existence to the page before approval.

VaultMaster's own API continues to verify both native and software responses
through `@simplewebauthn/server`. Registration options derive the account user
handle server-side; single-use registration tokens bind account and live device.
Reauthentication assertions additionally bind device, operation and ceremony,
so login/reauthentication challenges cannot be exchanged. Non-null authentication
user handles must match the credential's account. Origin/RP verification and
credential ownership are mandatory. Native counters use compare-and-set updates
to prevent out-of-order assertions from moving the stored counter backwards. Public credential IDs remain globally unique;
duplicate registration returns a generic verification failure and no successful
notification. Setup and verify retain separate password/MFA reauthentication
proofs, transactional security-state checks and existing durable rate limits.
In-memory challenges expire after five minutes and are lost on API restart;
there is no migration to a distributed challenge store. Multi-instance
operators must route a ceremony to the same instance or accept a failed retry.
No new public account-discovery endpoint is added. Existing signup availability
behavior described in the sensitive-action policy is unchanged.

No credential ID (including an internal credential record reference), client
data, attestation object, assertion, key, decrypted field or challenge is logged.
Existing allowlisted API/extension observability remains in place. Security
notifications use fixed action messages, and API failures are generic.

## Compatibility and deployment

No database migration, new dependency, encryption-format rewrite or host
permission is needed. Ship the API hardening before the updated web/extension.
In-flight old registration/reauthentication challenges fail closed after the
API change; request new options. Existing native login credentials, encrypted
items, history, attachments, sessions and backups remain compatible. Older
clients can carry the new opaque private-key field but cannot sign it; legacy
vault private-key formats remain storage-only. Rollback retains ciphertext and
new records, but the previous extension cannot sign them. Do not downgrade the
API authorization changes to regain old in-flight challenge compatibility.

The extension manifest adds a top-level MAIN-world document-start script and
removes the old web-accessible script resource. The existing isolated script
continues handling all-frame autofill. The MAIN script has no extension APIs,
secrets or approval controls. Packaging still allowlists every shipped file,
including the new client crypto module. Rebuild with the intended
`VAULTMASTER_APP_URL` and `VAULTMASTER_API_URL`: the former also excludes the
configured vault origin from software passkey interception. Deploying to a new
origin does not transfer RP credentials or platform local-unlock credentials.
No store publication or production deployment is part of this feature.

## Reproducible checks

API `passkey.integration.test.mjs` exercises actual registration/signature
verification, token replay, account/device/operation binding, wrong user handle,
origin/RP failures, generic duplicates, notifications and audit privacy against
synthetic accounts in an isolated PostgreSQL cluster. Crypto tests independently
verify DER signatures/RP hashes and password-wrapped encrypted recovery, legacy
rejection, edited bindings, allow/exclude lists and scope errors. Web editor tests
preserve key bindings and display edits. Extension tests check ciphertext-only
writes, explicit selection/guards, lock/unlock, delayed lock races, revocation,
protected popup approval, page denial, cancellation and single-use delivery.

`apps/extension/tests/browser/passkey.mjs` runs the installed MV3 extension in real
Chromium under strict site CSP. It verifies emitted registration/assertions using
the actual server library and checks protected approval, no automatic/page-forged
approval, cancellation/AbortSignal, replay policy, RP/origin/UV rejection,
lock/unlock, encrypted record recovery, duplicate exclusion, worker restart,
document replacement and session revocation. Existing web and autofill browser
regressions remain required. Browser vault HTTP responses use synthetic fixtures;
actual API/PostgreSQL verification runs separately. No live third-party account,
production traffic, native OS sync or hardware-security property is tested.

The existing isolated backup drill now creates a real synthetic passkey,
exports/restores its encrypted item/history/trash through the full personal
backup format after source-account deletion, and verifies signatures after
re-encryption and PostgreSQL dump/restore. Its secret-free report records only
statuses/counts/hashes. See [backup drill](BACKUP_RESTORE_DRILL.md) for invocation
and isolation. Local final results are recorded in the P2-1 roadmap entry; the
[secret-free recovery evidence](evidence/p2-1-backup-restore-drill.json) pins the
scenario hashes and checkout parent used before the feature commit.
On Node 26, run web unit tests with `NODE_OPTIONS=--no-experimental-webstorage`
so jsdom supplies browser storage rather than Node's file-backed global. The
CI runtime remains Node 22. No product storage or encryption setting changes.

References: [WebAuthn Level 3](https://www.w3.org/TR/webauthn-3/), including
[authenticator data](https://www.w3.org/TR/webauthn-3/#sctn-authenticator-data),
[registration verification](https://www.w3.org/TR/webauthn-3/#sctn-registering-a-new-credential),
[assertion verification](https://www.w3.org/TR/webauthn-3/#sctn-verifying-assertion),
and [Chrome content-script execution worlds](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts#execution-world).
