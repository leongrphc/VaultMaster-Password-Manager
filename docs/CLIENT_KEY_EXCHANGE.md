# Client sharing and emergency snapshots (P2-2)

This v1 protocol delivers immutable encrypted personal snapshots to a verified
recipient device. Management is in Settings → Paylaşım. The extension's protected
popup opens this screen; it does not transfer its native session/key to the web.
The web requires its own login and unlock. After explicit import, the extension
syncs the recipient's ordinary encrypted personal items under its own session.
There is no collaborative editable vault, automatic ongoing sync, or unattended
emergency recovery in this version. No forward secrecy, offline emergency access,
production deployment or independent security audit is claimed.

## Enrollment and trust

On an unlocked web device, explicitly create a contact card and reauthenticate
with the existing password/MFA policy. WebCrypto creates distinct P-256 ECDH and
ECDSA keys; only public uncompressed points and a random key ID form the card.
PKCS#8 private material is serialized solely inside a DEK-encrypted AES-256-GCM
wrapper. The wrapper authenticates the purpose/version, live device ID and card
fingerprint. Imported private/public pairs are checked before use. The API stores
that wrapper, never plaintext private keys. Password changes still rewrap the
stable personal DEK; exchange operations do not modify login/unlock/session policy.
No exchange secrets are stored in persistent plaintext storage or page bridges.
Browser/JavaScript memory cannot be guaranteed to be securely erased.

Exchange the entire public contact card through an independent trusted channel.
Its SHA-256 fingerprint covers `[1,id,agreementPublic,signingPublic]`. The sender
pastes and explicitly verifies the recipient card before sharing/inviting. The
recipient pastes and verifies the sender card before accepting or decrypting.
An owner must verify the recipient again before an emergency grant. A checkbox
is an assertion of this independent comparison, not automatic identity proof.
Cards identify a live account device, not an email/name. There is no account
lookup or email invitation endpoint. Guessed, deleted, expired, mismatched and
revoked targets return the same unavailable response without account details.
Valid contact-card capability possession necessarily permits checking whether
that device can receive a new invitation; this is not a public account directory.
The API knows account/device relationships, purpose, size, timestamps and status;
zero knowledge here refers to vault content and private key confidentiality.

## Authenticated encryption transcript

The client generates a new ephemeral P-256 ECDH pair for every envelope and agrees
with the pinned recipient public key. It derives an AES-256-GCM key using
HKDF-SHA256: salt is SHA-256 of the authenticated header, and info is the UTF-8
string `VaultMaster:exchange-payload:v1`. The ephemeral private key is never
serialized or uploaded. The recipient static agreement key is encrypted at rest.

The header is UTF-8 JSON of this ordered array:

```
["VaultMaster:key-exchange:v1", invitationId, kind, senderFingerprint,
 recipientFingerprint, expiresAt, envelopeRevision, ephemeralPublic, iv]
```

Expiry is canonical ISO UTC, ID is random UUID, fingerprints are lowercase
SHA-256 hex, public points are canonical padded base64 and IV is fresh 96-bit
random data. This header is GCM additional authenticated data; the 128-bit tag
protects encrypted bytes. ECDSA/P-256/SHA256 signs UTF-8 JSON of
`[base64(header), ciphertext]`, with WebCrypto's 64-byte P1363 signature. The API
verifies the public signature and exact transcript before storage; clients verify
it independently against the out-of-band pinned sender before decrypting. Unknown
fields, malformed encoding/points, wrong device/purpose/ID/expiry/revision, altered
ciphertext and invalid signatures fail closed. These operations use the standard
[Web Cryptography API](https://www.w3.org/TR/WebCryptoAPI/).

The payload contains a versioned personal snapshot, invitation-bound backup ID,
and a fresh random **snapshot** data key. Every snapshot item is encrypted under
this separate key; the source personal DEK is never shared. The outer envelope
protects the snapshot key, all content and nested ciphertext. Sharing includes
only the selected active items' complete secret fields, including passkey private
material if explicitly selected. Item attachments/history are excluded from
selected sharing; folders are not carried. Preparation reads live ciphertext
directly and rejects missing, deleted, changed or unavailable selections; ordinary
offline sync fallback cannot authorize sharing. Emergency grants include all personal
items, history, trash, folders and attachments through the existing full snapshot
validation/re-encryption code. No live/source item IDs authorize destination
writes. The serialized outer plaintext limit is 2,000,000 UTF-8 bytes; exceeding it
fails before upload, with no silent truncation. Large/streaming shared envelopes
are unsupported even though personal v4 backups support larger snapshots.

## Approval, states, timing and replay

Every enrollment, rotation, send, accept, request, grant, reject, revoke and open
requires its own existing single-use five-minute account/device/operation-bound
reauthentication proof, with configured MFA. The UI additionally asks for explicit
send/action confirmation; no page or extension content message can approve it.
Unknown/invalid actions never mutate state. Mutation validation and fixed-message
notifications commit together; ciphertext, keys, cards, emails, stable identifiers
and arbitrary error text are absent from application logs/telemetry. Account FKs
in authorization/notification storage remain necessary operational state.

| Kind | Allowed progression |
| --- | --- |
| Share | pending → recipient accepts → accepted → explicitly open/decrypt |
| Emergency | pending → recipient accepts → accepted → recipient requests → requested → owner explicitly grants → granted → explicitly open/decrypt |
| Emergency rejection | requested → owner rejects → accepted; a new request starts a new wait |
| Revocation | either participant may revoke any live state; payload cleared atomically |

Emergency invitation/request states contain **no recovery ciphertext**. The
waiting period (1–720 hours from the server request timestamp) is a minimum before
owner grant, not an automatic release timer. The client also checks this minimum
before preparing the snapshot. Only a new explicit online owner approval creates
and uploads the recovery envelope. An unavailable/deceased owner cannot grant;
use an independently held encrypted personal backup for that recovery scenario.
We deliberately do not escrow the live vault DEK or a pre-released snapshot key.
A compromised server cannot invent the pinned owner's signature or decrypt data,
but its timestamps/statuses are not a cryptographic trusted clock.

The invite expires in at most 30 days, for all actions and delivery. Expiry stops
server access and client decryption in the normal online workflow; it does not
make downloaded ciphertext or plaintext disappear. No crypto time lock exists.
The envelope revision for a share is 0. Emergency grant binds the newly committed
state revision; rejecting/re-requesting increments revision, so an old grant
cannot satisfy a later request. State changes require an exact expected revision
and lock both accounts, both live devices, both keys and the invitation in stable
order. Competing actions have one valid winner; stale callers need fresh approval.
A proof is consumed even on validation failure. Database conflicts fail closed;
mutations/proofs are never automatically replayed.

The immutable invitation UUID and request hash make an **exact create retry**
idempotent without duplicate effects/notifications. Changed bodies and revoked
IDs fail. Read/open may repeat after fresh approval. Destination restore uses the
invitation UUID as its durable backup receipt, so concurrent/repeated imports
cannot create another set of records. Signature verification alone does not stop
replay: server state, expected revisions, consumed proofs and restore receipts
provide that protection. Do not delete unexpired revoked invitation tombstones.

## Revocation, rotation, sessions and recovery

Revocation clears the server payload and retains a tombstone until expiry. Each
new share/replacement must use a fresh invitation ID, snapshot key, ephemeral key
and IV. Old snapshots are immutable; sending an update is a separate explicit
share. To rotate a device contact key, explicitly delete it (all its incoming and
outgoing invitations cascade), then separately approve a new enrollment. Exchange
and verify the new card; never reuse an old card or restore it onto another device.
The API refuses existing-key replacement by POST. Revocation cannot recall secrets
or ciphertext already obtained by recipients, backups, compromised clients or a
server retaining historical ciphertext. There is no forward secrecy: compromise
of the recipient static private key can expose captured historical envelopes.
No key transparency or malicious-server metadata rollback resistance is claimed.

Logout/reuse flags deny envelope delivery from/to that device; device deletion and
account deletion cascade keys and grants. Expiry denies reads/actions even if an
old list remains displayed. Lock/unlock and navigation invalidate pending client
work and clear approvals/reviews. An already accepted network mutation may finish
after lock; the client cannot recall it and never restores plaintext on a late
response. Key wrappers survive ordinary password rewrap on the calling device;
other-device revocation from password change removes their invitations. Native
extension and web devices are distinct; invitations do not automatically roam
between devices or new login sessions.

Decrypted snapshots are validated and re-encrypted under the destination DEK,
then enter the existing client import conflict review. Exact items default to skip;
other conflicts default to preserving existing items, with explicit keep-both or
approved update where permitted. History/attachment conflicts remain skip/keep-both.
Stale review state aborts the atomic restore. Receiving/reviewing does not write
personal data automatically. Once a snapshot is delivered, a recipient's retained
copy can be imported after sender revocation; revocation cannot erase released
knowledge. Ordinary personal backup/restore preserves explicitly imported data
and passkey capabilities, but excludes contact keys, invitations and approvals.
Re-enroll these relationships after personal recovery. PostgreSQL server recovery
includes encrypted wrappers/grants/session state and requires the same DEK to
unwrap, the same device binding and still-live account/session/expiry state.

## Compatibility and deployment

Apply additive migration `20261006030000_client_key_exchange` before the API, then
publish rebuilt web/extension. Existing accounts, personal ciphertext, DEK wraps,
backups and six prior migrations remain unchanged. Two new tables reference the
existing devices with cascade deletion. Old manually wrapped shared-vault and
emergency rows are retained, but their API routes return generic 410 for all
operations. They cannot be safely upgraded without knowing their original client
key scheme and independently verifying recipients. Explicitly recreate them via
v1; do not attempt server-side re-encryption. Old clients continue personal vault
sync but cannot use their raw-ciphertext sharing screens. The old API must not be
redeployed as a fallback because it reopens unverified/pending access. An additive
schema rollback retains data; use a forward fix for exchange behavior.

The historical `pnpm drill:observability-rollback` command now exits nonzero at
its unchanged `checkRollbackTarget` guard because schema/lockfile state differs
from the P0-5 pin. That artifact also restores unsafe legacy sharing authorization,
so it is intentionally **blocked**, not approved or bypassed. The focused
`key-exchange-rollback.test.mjs` gate verifies this denial. CI uses that denial
gate plus the new isolated API/Chromium/recovery runner; it does not claim the
historical artifact rehearsal passed. No approved production rollback artifact
for v1 exists yet. A forward fix or independently reviewed new pin is required.

Operators may schedule (using database time):

```sql
DELETE FROM exchange_grants WHERE "expiresAt" <= CURRENT_TIMESTAMP;
```

Keep device keys while their device remains valid; device/account deletion handles
cascade cleanup. Server backups still need access controls for operational metadata
and historical ciphertext. No new dependency outside existing workspace crypto,
host permission, email service, or background grant task is added.

## Reproducible verification

Use synthetic accounts only. The dedicated runner takes no database URL/arguments,
scrubs deployment/telemetry/preload environment, provisions a private Unix-socket
PostgreSQL cluster with TCP disabled, applies real migrations, runs all API tests,
runs built-web Chromium against the real API/database, and runs personal/file and
PostgreSQL recovery checks. It stops its cluster/removes private logs and dumps
before writing successful secret-free evidence. Build the static app first.

```sh
pnpm install --frozen-lockfile
VAULTMASTER_STATIC_EXPORT=1 NODE_ENV=production pnpm build
bash scripts/key-exchange-checks.sh
NODE_OPTIONS=--no-experimental-webstorage pnpm --filter @vaultmaster/web test
pnpm --filter @vaultmaster/crypto test
pnpm --filter @vaultmaster/extension test
pnpm test:web:browser
pnpm test:extension:browser
pnpm lint && pnpm typecheck
pnpm test:dependency-audit && pnpm audit:dependencies
pnpm audit --audit-level=critical
pnpm test:backup-drill-safety && pnpm test:observability && pnpm test:docs
node --test scripts/tests/key-exchange-rollback.test.mjs
pnpm drill:backup-restore
```

Crypto checks cover independent signature/agreement, tampering of every transcript
field, wrong keys/devices/expiry/purpose/revision, fresh encryption and password
rewrap. API checks cover explicit proof gates, pending-access denial, immutable
retry, concurrent proof consumption/state actions, emergency absence/wait/grant,
rejection/request replay, expiry, rotation, logout/deletion and generic targets.
Web checks cover ciphertext-only upload, contact mismatch, lock races, emergency
absence, destination re-encryption and conflict review. Actual Chromium checks
cover creation, acceptance, revoked/expired delivery, replay/concurrency, full
emergency snapshot review, repeated import conflicts, lock/unlock and device
removal. Existing browser checks cover personal backups/restores and MV3 passkey
recovery/fill/session effects; the extension management shortcut is checked in
Chromium and against forged page/content messages. The isolated PostgreSQL drill
also decrypts a recovered authenticated emergency envelope using its restored
wrapped device key and verifies a recovered passkey signature. No live user,
third-party availability, production deployment or hosted CI result is claimed.
