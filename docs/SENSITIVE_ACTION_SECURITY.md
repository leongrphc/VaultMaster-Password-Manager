# Sensitive-action security (P0-4)

Terminology: [shared glossary](TERMINOLOGY.md). User steps and current combined
limitations: [extension guide](../apps/extension/README.md). Historical verification
sections below describe their original feature scope.

Implemented on `feature/p0-4-sensitive-action-security`, 6 October 2026.
This is an implementation and regression-test record, not an independent audit.

## Policy and compatibility

An active, device-bound session alone cannot authorize account deletion, master
password change, explicit export (encrypted JSON, plaintext CSV, selected plaintext
JSON, v3/v4 full backup), TOTP setup/enable/disable, recovery-code regeneration,
WebAuthn registration/rename/removal, or device rename/revocation.
The shared `sensitiveAction` policy covers Express's case-insensitive routes,
trailing slashes and HEAD dispatch as well as the normal web paths.

`POST /api/auth/reauthenticate` accepts `{method,path,authHash}` where `path` is
relative to `/api`, with no query string. Password verification uses the existing
client-derived authentication hash and server Argon2 verifier; the raw master
password and vault key never leave the client. If TOTP or WebAuthn is configured,
a second step additionally requires one existing login factor: `code`,
`recoveryCode`, or `webAuthnResponse` with `webAuthnChallengeToken`. A password-only
attempt returns `requires2FA` and, when available, WebAuthn authentication options.
TOTP windows and WebAuthn presence/verification semantics match existing login.

The response contains a random 256-bit `proof`, valid for five minutes. Only its
SHA-256 digest is stored. Send it as `X-VaultMaster-Reauth` on the requested
operation. It binds the account, live device, exact HTTP method/path and verified
password/MFA configuration. Consumption is an atomic PostgreSQL delete: parallel
replays have at most one winner. Missing, expired, replayed, foreign or stale
proofs return generic 403 `REAUTH_REQUIRED` before resource lookup. HEAD snapshot
requests are protected; proofs are issued only for GET/POST/PATCH/DELETE.
Changing security configuration invalidates outstanding proofs. Revocation and
account deletion cascade device/account proofs; refresh does not extend them.

Proofs are consumed even when subsequent validation or mutation fails. A lost
response or failed operation needs a new proof, never automatic mutation replay.
Recovery codes used for proof issuance are consumed once, with serialized/CAS
checks preventing concurrent reuse; they remain consumed if the later action
fails. Recovery-code login also uses CAS. TOTP remains a time-based factor and
can authorize distinct fresh proofs within its existing acceptance window; this
does not make a proof reusable. Existing in-memory WebAuthn challenges expire or
are lost on restart; retry that challenge step. Accepted proofs remain durable.

Account/security mutations recheck the verified configuration and live device
inside their transaction. User/device row locks order sensitive changes against
password changes and revocation. Password changes still only rewrap the stable
DEK, compare envelope version/hash, retain the calling session and revoke other
devices. TOTP/WebAuthn changes retain sessions, as before. Logout remains usable
without reauthentication. Cookie attributes, CSRF checks, refresh rotation/reuse,
encryption formats and backup restore idempotency are unchanged.

Deploy the migration and new API before the web client. Older/native clients can
continue login, sync and logout; sensitive operations now need the explicit proof
endpoint/header. Update these clients before attempting those operations. Do not
silently restore session-only authorization to support an old client.

The web holds dialog credentials/proofs only in memory, clears them on completion
or cancellation and rejects pending approval on unmount/lock/account change. An
existing password-change/deletion auth hash avoids a second password entry;
configured MFA is still required. Exports retain their plaintext warning/explicit
confirmation and require an online approval. A locked/changed unlocking session
cannot complete a pending download.

## Durable limits

Every limiter uses an atomic PostgreSQL fixed window and database time, including
existing general, refresh and backup chunk limits. No process-memory counter is
used. Storage failure returns a server error and stops the operation. `429`,
`Retry-After` and standard rate-limit headers apply equally to success and failure.
Budgets are conservative fixed windows, not sliding windows; a boundary permits
one budget before and another after the boundary.

| Scope | Budget per 15 minutes | Identity |
| --- | --- | --- |
| General API (excluding chunk reads/writes) | 100 | IP |
| Login/registration, combined | 10 | Normalized submitted email (IP if absent) |
| Login/registration, combined | 50 | IP |
| Reauthentication (including MFA challenge steps) | 10 | Authenticated account |
| Reauthentication | 50 | IP |
| Sensitive operations, combined | 30 | Authenticated account |
| Password unlock | 5 | Account, independently 5/IP |
| Refresh | 30 | IP |
| Backup chunks | 400 | Account |

Authenticated budgets derive identity from the session, never a submitted email.
Unauthenticated email budgets apply to nonexistent accounts too. Keys are scoped
HMAC-SHA256 digests, using the existing server JWT secret; raw IP/email values
are not retained in the limiter table. Equivalent IPv6 addresses and addresses
within one /64 share an IP budget; IPv4-mapped IPv6 normalizes to IPv4. Secret
rotation intentionally changes limiter key digests and resets those budgets.

Deployment retains the existing one-hop proxy trust setting. The trusted ingress
must overwrite forwarding headers and the API must not be reachable through an
untrusted alternative proxy path. Account budgets remain effective across IPs.
No CAPTCHA, email verification service or distributed edge/WAF is added here.

## Notifications and privacy

Settings → Güvenlik → Güvenlik Bildirimleri shows the latest 50 account-scoped
notifications, newest first, with timestamp and acknowledgement. It refreshes on
entry, manually, and every 30 seconds while mounted. Messages describe new login,
refresh reuse/revocation, password/session effects, TOTP/WebAuthn changes, replaced
recovery codes and approved export/prepared backup. Immediate success messages
also explain password revocation, 2FA/code changes and completed deletion.

Notification rows store only an ID, account ID, fixed action type, timestamps and
read state. Messages are a fixed server allowlist. They contain no password/hash,
key, MFA secret/code, ciphertext, IP, user-agent or user-supplied device/key name.
Failed or replayed actions do not create a success notification. Security
mutations, session creation/reuse revocation and their notifications commit
atomically; notification insertion failure rolls the mutation back. Successful
v4 snapshot staging and its notification also commit together. Export approval
and v3 snapshot notification mean approval/preparation, not proof that an OS
finished saving a file. Existing detailed audit events remain separate/best effort.

The inbox is in-app, not email/push delivery; no outbound mail service is configured.
Account deletion shows confirmation to the caller and removes its inbox with all
other account data. Unknown and foreign resource IDs have identical outward
responses; foreign/unknown notification acknowledgement is an identical no-op.
Wrong-password and unknown-account login share the same outward response and
perform Argon2 verification. Existing immediate signup still distinguishes a
successful new registration from a duplicate (409 with a generic error); hiding
signup availability requires a separate email-verification/enrollment design.
P0-4 does not add that design or change immediate-registration session semantics.

Reauthentication protects explicit operations in the official client and API;
it cannot prevent a compromised unlocked client from copying plaintext already
in memory, or a valid session from retrieving ciphertext through normal sync.
Already-issued backup transfer handles remain account-scoped and expire under
the existing one-hour transfer policy; chunk retries need no new proof.

## Migration, maintenance and rollback

Apply `20261006020000_sensitive_action_security` with the existing migration runner.
It adds `abuse_buckets`, `reauthentications` and `security_notifications`; account
and device foreign keys cascade appropriately. No existing ciphertext/session
column is rewritten. Back up the schema before deployment as usual.

Expired limiter rows/proofs are inaccessible or reset at use, but inactive rows
need periodic maintenance. Run the following SQL daily on the server. Deleting
only expired budgets cannot reset an active limit. Notification retention is a
product/operator decision; this example retains 90 days while the UI displays
only the latest 50. No scheduler/observability service is added by P0-4.

```sql
DELETE FROM abuse_buckets WHERE "expiresAt" < CURRENT_TIMESTAMP;
DELETE FROM reauthentications WHERE "expiresAt" < CURRENT_TIMESTAMP;
DELETE FROM security_notifications
  WHERE "createdAt" < CURRENT_TIMESTAMP - INTERVAL '90 days';
```

A web rollback can leave the additive tables in place, but old clients will fail
closed for sensitive operations. An API rollback removes the new authorization
policy and is a deliberate security downgrade; do not present it as equivalent
protection. No production deployment was performed for this feature.

## Verification

All database work uses synthetic accounts in disposable local PostgreSQL 18
clusters, with TCP disabled. The focused tests cover success/failure, exact
scope/expiry/state binding, concurrent replay, configured TOTP and signed WebAuthn,
concurrent recovery-code reuse, durable account/IP budgets (including a fresh
child process), IPv6 normalization, storage fail-closed behavior, account/resource
privacy, notification rollback/isolation/acknowledgement, session/device effects,
CSRF/cookie deletion, dialog cancellation, lock races and secret-free messages.
Existing crypto/password-history/trash/attachment/backup regressions remain active.

The API runner uses its existing `--experimental-test-isolation=none`; select
`VAULTMASTER_TEST_DATABASE_URL` and supply synthetic API environment values.
Independent API test processes must not share this suite's cleanup users. Web
Vitest on this host uses `NODE_OPTIONS=--no-experimental-webstorage`. Extension
tests run through their workspace script. Browser checks use local static assets
and fixtures, with `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64` on this host.
The backup drill now approves snapshots through the real proof endpoint and
removes synthetic orphaned limiter rows during its empty-database cleanup check.

Final check results are recorded in the P0-4 entry in
[the current roadmap](../CURRENT_DEVELOPMENT_ROADMAP.md). No provider deployment,
production data, delivery-service integration or independent audit is claimed.
