# Health report progress, cancellation and privacy (P1-4)

The health report operates in the unlocked web browser. It uses the existing
vault operation guard and invalidates work on lock, logout, key/account change,
vault item replacement and navigation/unmount. No API job, queue, report receipt,
stream endpoint, database migration, background worker or persistent report is
introduced. `/api/health` and `/api/health/ready` remain service probes; their
responses do not represent a vault analysis. Backup/restore/import transports,
reauthentication, cookie sessions, security epochs, vault encryption and formats
are unchanged. P1-5 is outside this change.

## Progress and completion

Local strength and duplicate analysis runs synchronously over the current loaded
personal login entries. The page displays the resulting aggregate counts only
after that computation. It does not invent incremental CPU progress or an ETA.
The breach check is a separate explicit opt-in operation, never triggered merely
by entering the page. Its immutable input is the current loaded login snapshot;
trash, history, attachments and shared vaults are not a complete-account audit.

| Phase | Meaning | Units |
| --- | --- | --- |
| idle | No active breach check or published completion | No completion claim |
| hashing | Browser prepares the current password's protocol digest | Current phase indeterminate |
| requesting | Awaiting provider headers/body | Current phase indeterminate; no ETA |
| matching | Validating provider rows and comparing the suffix locally | Current phase indeterminate |
| completed | All entries successfully validated and matched; results published together | completed = total |
| cancelled | User cancelled; partial results discarded | Retains only aggregate work counts, not a report |
| error | Hashing, transport, HTTP, timeout, parsing or guard failure | Retains only aggregate work counts, not a report |

The determinate progress bar counts **successfully checked login entries** out of
the snapshot's login entries. It increments only after an HTTP success, valid
range response and local match. Repeated passwords still count as separate entries
and are requested sequentially; there is no persistent hash/prefix cache. A second
indeterminate progress bar identifies the active phase. A request sent/accepted,
a timer ticking or a retry starting cannot increase completed units. Only a
successful whole run displays completion/100%. Unknown breach coverage stays `?`
on cancellation/error rather than falsely showing zero. The strength score is a
heuristic, not a security guarantee, and no provider match is not proof of safety.

## Cancellation, recovery and cleanup

A ref claims the active run synchronously, preventing duplicate starts before a
React render. Cancel releases that claim and aborts the request/body. Duplicate
cancel events and cancellation of an already-terminal run are no-ops. A retry is
a new run; controller identity, snapshot identity and the existing session guard
prevent an old digest or HTTP response from updating the new run. WebCrypto
digest cannot be interrupted, but its result is checked before any network request.
The byte array used to encode the password is zeroed after hashing.

Each request/body has a 15-second timeout. Timers and abort listeners are removed
on every exit. HTTP errors, malformed/empty ranges, duplicate suffix rows,
noninteger/unsafe counts, oversized parsed responses and redirects fail closed.
Provider errors and caught exceptions never appear in UI/logs; failures have fixed
copy. Failure discards all partial matches, enables a fresh attempt and does not
silently retry or treat unknown entries as safe. Starting another run clears the
previous report. Vault changes clear both published and pending reports; leaving
the page unsubscribes and aborts without late React updates.

There is no vault mutation to roll back: unpublished matches are discarded and
published results are memory-only. Clearing references allows garbage collection;
JavaScript strings, browser internals and the ordinary unlocked vault cannot be
promised secure memory erasure. Cancellation cannot recall a prefix already sent
or erase third-party logs. There is no resume after reload/navigation. The existing
backup transfer DELETE endpoint is separately regression-tested for owner scoping,
concurrent/sequential replay, chunk cleanup and unchanged vault ciphertext. That
endpoint deletes staging, not committed imports; existing atomic commit/receipt
and rollback semantics remain in effect. A report cancel never calls it.

## Privacy boundary

Local strength/reuse analysis sends nothing. Health rows show temporary record
numbers, counts and fixed categories, never passwords, titles, usernames, URLs,
folder names, item IDs or raw provider errors. Numbers refer only to the current
loaded login order; they are not stable identifiers. Users locate/edit entries in
the ordinary vault UI. This report offers no export or diagnostic payload.

The browser computes SHA-1 solely for the Pwned Passwords range protocol. It sends
only five uppercase hexadecimal prefix characters to the HTTPS provider URL;
the remaining suffix/full hash, password, vault key and record metadata are not
sent. Matching occurs locally. SHA-1 does not replace any encryption/KDF. Requests
omit credentials and referrer, disable HTTP caching, reject redirects and request
`Add-Padding: true`; matching accepts zero-count padding rows. The existing service
worker bypasses cross-origin traffic. Optional Sentry telemetry drops provider URL
breadcrumbs so password-derived prefixes are not retained with unrelated errors.
No report state is stored in local/session storage, IndexedDB, API logs or backups.

HIBP necessarily sees the prefix, public IP address and timing; prefixes may help
infer common passwords and repeated requests may be correlated. Network operators
can observe connection metadata; HTTPS ordinarily protects the URL path, while a
TLS-inspecting intermediary could see it. Padding is requested, not proof of
provider behavior or anonymity. Provider availability, retention, corpus freshness
and live-service behavior are not guaranteed by this application. Browser/devtools,
compromised clients and plaintext already held by the unlocked vault remain outside
this report's protection. No external privacy-policy or independent audit claim is
made.

## Verification (6 October 2026)

All fixtures are synthetic. API tests use a newly provisioned local PostgreSQL
cluster with TCP disabled, committed migrations and destruction on exit. The
focused API regression checks probe isolation, absent report job endpoints,
unauthenticated/foreign transfer cancellation, indistinguishable unknown handles,
concurrent and repeated owner cancellation, staging chunk cleanup, rejected commit
after cancellation and preservation of ciphertext/no restore receipt.

Focused web tests cover successful-only unit accounting, indeterminate phases,
no request before opt-in, secret-free rows/privacy copy, partial rollback, duplicate
cancel, stale responses after a fresh run, unmount/lock/item-change invalidation,
HTTP recovery, digest cancellation, request timeout/timer cleanup and optional
telemetry filtering. Crypto tests cover a known SHA-1 vector, exact suffix matching,
zero-count padding and malformed/duplicate/oversized/unsafe-count rejection.

Real Chromium runs the built static application with production CSP and real
WebCrypto. Only the API/provider are intercepted with synthetic responses. The
health scenarios check opt-in, prefix-only transport, padding/no cookies/referrer,
indeterminate progress, actual request abort, duplicate cancellation, late responses,
HTTP/malformed-response recovery, successful completion, storage privacy,
navigation away/back and lock/unlock. Existing backup/import/session/cross-tab
checks execute in the same browser run. This is not a live HIBP availability check,
production backend exercise or large-vault performance benchmark.

Required suite results are recorded in the P1-4 roadmap entry. The two existing
navigation lint warnings and the two time-bounded reviewed dependency constraints
remain; no new exception is added. Deployment is a normal API-compatible web and
crypto-package rebuild, with no data migration. Rollback is a web rebuild/redeploy;
no vault content, import receipt or encryption format is rewritten. No production
deployment or independent security audit is claimed.
