# P0-5 observability and deployment rollback

This implementation is locally tested, not deployed. Production monitoring is
**inactive until explicitly configured**. No live service, account, backup or
provider rollback was exercised. Maintainers own alerts and release acceptance.

## Privacy contract

Application logs use schema version 1 in
`packages/shared/src/observability.ts`. The API adds its own UTC timestamp and
fixed severity. The shared boundary builds a new object from an allowlist;
unknown fields, invalid values and nested objects are discarded. There is no
exception serialization or regex-based attempt to mask arbitrary payloads.

| Field | Allowed values / source |
| --- | --- |
| event | http_request, validation_error, unhandled_error, audit_log_write_failed, server_started, client_error, sync_result, backup_result, database_probe, health_alert, health_recovered |
| component | api, web, extension, monitor |
| operation | api, database, sync, backup, offline, client |
| outcome | success, failure, cancelled, degraded |
| reason | network, http, invalid_response, decrypt, storage, timeout, internal |
| method | GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS |
| statusCode | finite integer 0–599, from transport response |
| durationMs | finite integer 0–300000, from local elapsed time |
| alert | api_unavailable, database_unavailable, api_errors, sync_errors, backup_errors, backup_stale |
| requestId | random UUID minted by this module in this process, retained for at most five minutes / 4096 recent IDs |

Never add passwords, auth hashes, MFA codes, session/reauthentication tokens,
keys, vault plaintext, ciphertext, raw URLs/query strings, email addresses,
account/item/device/transfer/backup identifiers, IPs, user agents, arbitrary
messages, stacks, validation details or response/request bodies to this schema.
Event names and classifications are fixed literals, not user-derived labels.
The server ignores every incoming correlation header, including UUID-shaped
values. Its response header/error ID correlates only that request's server logs;
IDs are not derived from users or reused across requests. Clients generate fresh
local diagnostic IDs and do not log or trust server-provided IDs. There is
intentionally no cross-client/session identity or end-to-end tracing baggage.
Expired/evicted IDs are omitted rather than trusted by format alone.

Web application console errors now emit fixed structured events. Web transport
records network/HTTP/invalid JSON outcomes; vault loading records success or
partial-decryption degradation, offline read/write failures remain distinct.
Extension sync records transport, response-shape, decryption and cache-write
outcomes; failure still propagates and lock/session guards still apply. API
request completion records all sync/backup HTTP outcomes, including errors handled
inside route handlers. Crypto code emits no diagnostics, including on bad tags.
These events do not change encryption formats or retry policies.

Optional Sentry uses no default integrations, tracing or breadcrumbs. Explicit
messages carry sanitized fields only; `beforeSend` discards automatic/unmarked
events and reconstructs marked events, removing request/user/exception/stack/
URL/breadcrumb/tag/context/SDK event-ID data. Web failure/degraded events can be
sent only when its existing public DSN is configured. Extension diagnostics stay
local; there is no new telemetry endpoint or persistent diagnostic store. Sentry
and hosting infrastructure still see connection metadata such as IP/timing; this
contract covers application payloads, not anonymity or provider retention.
Configure short retention (7 days recommended), restricted operator access and
no edge/access-log query/header/body collection. Existing account audit/inbox
records are separate security features, not exported operational logs. Browser
runtime/devtools, development React diagnostics, platform access logs and
unhandled third-party code are outside the application logger's control.

## Checks, thresholds and operator responses

`/api/health` checks API liveness. `/api/health/ready` additionally checks a real
PostgreSQL transaction. Probes are unauthenticated, minimal and `no-store`; they
bypass the DB-backed limiter and perform no vault queries. Concurrent readiness
checks share one in-flight query. PostgreSQL statement timeout is 2 seconds,
Prisma maxWait/transaction timeout are 2/3 seconds, and the response deadline is
5 seconds. A deadline does not release the in-flight guard until the underlying
query settles, preventing accumulating queries against an unavailable database.
Failure returns a fixed 503; SQL/connection errors are never returned or logged.
The generic failure classification is timeout; it does not diagnose the cause.
Probe abuse must be constrained at trusted ingress, without logging identifiers.

| Signal | Alert threshold | Action |
| --- | --- | --- |
| API/database/proxy availability | Three consecutive failed samples per target; 90-second timeout, 30-second retry gap | Check provider outage/deploy status, then DB connectivity/pool/migration health. Database/proxy dependency failures produce one primary incident per poll. |
| API/sync server errors | Five or more 5xx, at least 20 requests, at least 20% failures within five minutes | Compare the accepted deploy revision; inspect sanitized outcome/status events, check readiness and abort release if synthetic sync fails. |
| Backup transport/server errors | Three or more 5xx, at least five requests, at least 50% failures within five minutes | Preserve existing archives, check readiness/transfer capacity and run the isolated recovery drill before retrying release. Never delete vault data to repair an export. |
| Daily operational backup heartbeat | Missing/invalid/future success timestamp or last verified success >=26 hours ago | Check the authorized backup job, storage and restore-verification result. Do not substitute a personal export or local drill for a server backup. |
| Client sync/decrypt/storage failures | Local diagnostic/UI troubleshooting; optional sanitized web telemetry, no page per client | Retry once after checking online/unlocked state. Preserve encrypted backup and snapshot; investigate version/KDF/cache issues without asking for vault data or raw logs. |

Server alert state is bounded process-local (latest 10000 samples, five minutes),
not a fleet metric or durable incident store. Emit once on threshold crossing;
recover only with minimum volume and <5% failures. Expected 4xx (including auth,
reauthentication, validation, conflict and rate limiting), cancellation, individual
failures and low-volume samples do not page. No-traffic and process restarts are
not proof of recovery. The external probe covers full outages and cold starts;
low-volume backup failure remains visible as an event and a user-visible failure.
Aggregate only `component=api` request events for server rates; client batch and
transport events are separate observations and must not inflate denominators.

The opt-in `Production health alerts` workflow polls every 15 minutes, with no
application/cloud credentials or vault access. Actions scheduling/notification
is best effort, not a paging SLA; outages can take a full poll and retry cycle to
surface. Poll results fail the workflow and contain fixed alerts only. Configure
an operator recipient using GitHub Actions failed-workflow notifications, test
that delivery using a synthetic failure, and deduplicate repeated failed polls
into one incident in your chosen alert service. Route API `health_alert` /
`health_recovered` log transitions to that same incident service. Do not collect
request bodies, access logs or user identifiers to make routing work.

Before enabling `VM_ENABLE_PRODUCTION_MONITOR=true` as a repository Actions
variable, connect the authorized daily server-backup job to
`VM_BACKUP_LAST_SUCCESS_EPOCH_MS`. It must be a trusted numeric millisecond UTC
success time, updated **only after backup and its prescribed verification succeed**.
Repository maintainers control both variables; missing heartbeat alerts when
monitoring is enabled. No backup scheduler/provider integration, recipient or
log drain is provisioned by this branch. Until these prerequisites are met,
production alert delivery and backup coverage must not be claimed as active.
The implementation has tests; no live availability or delivery claim is made.

## Release pins and compatibility gate

P0-5 introduces **no migration**. Keep all six existing migrations, including
`20261006020000_sensitive_action_security`. No down migration/reset is needed.
The local compatibility pin is `docs/rollback-target.json`:
`a74eb3152ee76230e25c4142360bc0ab48c52ce2`. The policy aborts if schema,
migrations (including untracked files) or lockfile differ from that pin. Future
migration/dependency changes require a new reviewed pin and drill. The prior API
is rebuilt with the identical lockfile/current generated Prisma client and shared
package, whose existing contracts are unchanged; artifact digests are recorded.
This is an API/schema compatibility rehearsal, not an archived production image.

**The local pin is not an approved production rollback target.** It predates
P0-5 privacy hardening. The drill disables its console sinks before import and
scrubs telemetry credentials. Rolling production back to that logger or to web
assets emitting raw exceptions violates this privacy contract. Abort such a
rollback; retain the current safe build and use a reviewed forward fix or a
privacy-hardened, tested fallback artifact. The older historical deployment in
DEPLOYMENT.md is also not a compatible/security-approved candidate by default.

Before any release, prepare an access-controlled release manifest with:

- Full 40-character candidate and approved fallback Git SHAs; exact lockfile hash,
  Node and pnpm versions; migration names/checksums and compatibility decision.
- Candidate/fallback Render deploy IDs and their verified Git SHAs; readiness path,
  approved environment configuration and references to stable secrets (never values).
- Candidate/fallback Cloudflare version IDs for Worker **and matching static assets**,
  asset archive/digest, same-origin proxy configuration, origins and CSP headers.
- Exact extension version/store identity and ZIP digest; browser/storage protocol
  compatibility, v3/v4 backup support and synthetic verification evidence.
- Named incident owner, alert recipient, maintenance/write-freeze decision and
  acceptance/abort criteria. A moving branch name or `latest` tag is not a pin.

Capture the known-good manifest before release; do not infer fallback versions
from provider history during an outage. Missing artifacts, changed secret versions,
failed migrations, uncertain schema compatibility, lost backup/KDF/session/security
compatibility or missing privacy protection are **abort conditions**. Restore into
an isolated database only if an approved data-recovery plan is needed; never
restore over the surviving production database to undo an application release.

## Operator rollback procedure (not executed by this branch)

1. Declare the incident, freeze releases and disable Render auto-deploys for
   `deploy/free-hosting`. Capture the current/fallback manifest and sanitized
   symptoms. Keep existing DB and backups. Do not rotate JWT/encryption/KDF secrets
   as a rollback step. Separate recovery of a compromised secret is another plan.
2. Re-run `pnpm drill:observability-rollback` and `pnpm drill:backup-restore` in an
   isolated checkout for the selected reviewed pair. Require successful cleanup,
   exact pins/digests and schema compatibility. If readiness/synthetic checks fail,
   stop before traffic changes. Never pass production connection URLs to drills.
3. Roll back web assets/proxy first **only if the fallback client is compatible
   with the current and fallback APIs**. In Cloudflare Workers & Pages, select the
   exact approved Worker version ID and its matching asset version from the
   manifest and perform Rollback. Verify version and public asset/extension ZIP
   digests. If clients require the newer API, leave that API running until client
   compatibility is established; already-open web tabs and installed extensions
   do not instantly downgrade. Preserve origins, CSP, cookies and key envelopes.
4. In Render service Deploys, select the exact approved successful deploy ID,
   verify its Git SHA/start command/environment and perform Rollback. Keep all
   additive DB migrations; do not run `migrate reset`, `db push`, destructive SQL
   or mark a failed migration applied without independent reconciliation.
   If the retained target artifact is unavailable, abort or build the exact
   approved SHA with frozen dependencies in staging, then review its digest and
   synthetic checks before switching traffic. Do not deploy a moving branch.
5. Require three consecutive healthy liveness/readiness responses over at least
   one minute, from both direct API and same-origin proxy; compare actual provider
   versions to the manifest. On any failed sample, wrong digest, incompatible
   migration or synthetic failure, stop acceptance and preserve data. Do not
   oscillate between releases. Keep incident alerts active, investigate the DB /
   provider and use the reviewed forward-recovery artifact when compatible.
6. With an authorized disposable synthetic account (never real user credentials),
   verify login, cookie-only web session/CSRF, lock/reload/unlock, encrypted vault
   create/read/update and destination decryption; independent extension sync;
   sensitive-action proof enforcement; v4 export/open/additive restore and retry
   receipt uniqueness, while confirming v3 support and unchanged existing data.
   Never print payloads, passwords, IDs, tokens, URLs or ciphertext. Remove the
   synthetic account/staging and retain only counts/statuses/digests. Local drills
   cover API/backup invariants; provider/UI checks require separate release evidence.
7. Observe at least one complete five-minute server window plus two external
   healthy polls and current verified backup heartbeat. Verify alert recipient
   recovery, retire the incident, and record accepted versions/limitations. Leave
   auto-deploy disabled until a separately validated forward fix is pinned and
   approved; reinstall/reissue extension artifacts only through its release guide.

[Render rollback documentation](https://render.com/docs/rollbacks) explains target
artifact retention and settings reuse: inspect secret/environment-group references
because the provider may restore target-specific configuration. Dashboard rollback
disables auto-deploy; API rollback does not. Free service history is limited, so
verify retention before release. [Cloudflare rollback documentation](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)
defines version rollback and binding/resource constraints. These provider actions
are not database undo operations. Use the installed Prisma 6 `db:deploy` script;
newer Prisma documentation/CLI syntax is not a reason to change the migration tool.

## Isolated verification and limitations

```sh
pnpm install --frozen-lockfile
pnpm test:observability
pnpm drill:observability-rollback
pnpm drill:backup-restore
```

The rollback harness takes no arguments, clears inherited database/cloud/telemetry/
Node preload settings, creates its own private Unix-socket PostgreSQL cluster
with TCP disabled, applies the real migrations and runs the complete API suite.
It compiles the pinned prior API from tracked Git source, then switches loopback
servers candidate → prior → candidate against that retained synthetic database.
Checks include readiness, an existing session, vault ciphertext decryption, v4
snapshot, retained reauthentication denial, unchanged migration checksums and
writes made after rollback readable after forward recovery. Synthetic monitor
fixtures check transient failures, sustained outage, suppression of dependent
alerts, missing/stale backup signal and secret-free output. Unit tests reject
unsafe pins, changed dependencies/migrations, telemetry payloads and inherited
credentials; focused API tests inject DB failure/hung queries and inspect logs.

The report is `test-results/observability-rollback-drill.json`, marked passed only
after account/table cleanup, cluster stop and temporary file deletion. It contains
pins/digests/counts/statuses, never account/connection/secret/vault data. Historical
artifact console sinks and telemetry are disabled in the worker; raw stdout/stderr
are discarded. SIGKILL/power loss cannot run cleanup; stop only the private
`/tmp/vm-drill.*` cluster as described in the backup drill runbook. A prior success
report is removed before each run. CI runs policy/isolation checks and the isolated
drill, and does not deploy. The separate backup drill verifies logical dump/restore
and personal recovery, including atomic transaction rollback and retry receipts.

No hosted CI result, live alert recipient, fleet aggregation, production backup,
provider PITR, large-vault benchmark, real Render/Cloudflare rollback, extension
store downgrade or independent security audit is claimed. These remain release
acceptance prerequisites, not work on P2. Existing partial-record load behavior
is now observable as degraded; this change does not redesign sync conflict or
corrupt-record recovery. No production services were deployed or queried.
