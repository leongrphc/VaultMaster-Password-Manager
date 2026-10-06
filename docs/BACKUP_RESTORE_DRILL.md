# Isolated production recovery drill (P0-2)

Run from a checkout with installed dependencies on Linux:

```sh
pnpm install --frozen-lockfile
pnpm test:backup-drill-safety
pnpm drill:backup-restore
```

Prerequisites: Bash, Node 22 or later, pnpm 9.15, PostgreSQL server/client tools
(`pg_config`, `initdb`, `pg_ctl`, `createdb`, `pg_dump`, `pg_restore`) from the
same installation. On Debian/Ubuntu install `postgresql postgresql-client`.
Run as a regular user; root execution uses `runuser` and the local `postgres`
OS account. Allow approximately a minute and several hundred MiB of free space.
The harness builds the API/crypto/shared packages and applies committed migrations.
It makes no deployments and needs no application secrets or cloud access.

The script accepts **no arguments or connection URLs**. It discards inherited
variables, including deployment credentials, PostgreSQL settings, Sentry DSNs
and Node preload options. It initializes a new cluster under a mode-0700 random
`/tmp/vm-drill.*` directory, disables PostgreSQL TCP, and uses a private Unix
socket. Local trust authentication is confined to that directory. Only its own
`drill_source` and `drill_recovered` databases are modified. Runtime working
directories prevent the API's dotenv loader from reading repository `.env` files.
Use a clean dependency installation and trusted tools in PATH.

The verification uses the deployed code paths, with entirely synthetic data:

1. Run the five existing backup integration regressions on the fresh database.
2. Register two disposable accounts with separate random vault keys; create a
   folder, active item, trash item, history version and encrypted attachment.
   Preserve an existing destination item. Padding forces multiple 1 MiB chunks.
3. Export via the v4 snapshot/HTTP chunk endpoints. Check account isolation.
   Use the actual web backup functions to validate and create a password-encrypted
   v4 file, delete the source account, reopen the file and re-encrypt for the
   second account. The file password and keys exist only during this run.
4. Upload chunks twice to simulate acceptance followed by a lost HTTP response.
   Verify staging has not changed the destination vault.
5. Inject an exception at receipt creation **after** folders, items, versions and
   attachments have been inserted inside the real PostgreSQL transaction.
   Require HTTP 500. Count records inside the transaction and after rollback;
   require an unchanged destination item, no receipt, and retained staging chunks.
   Injection exists only in the drill process, with no production fault endpoint.
6. Commit the same staged transfer again, including concurrent and sequential
   duplicate retries. Require exactly one receipt and one set of restored data.
   Decrypt every restored content type with the destination key; check history,
   trash, timestamps, mapped folder references and unchanged existing data.
7. Delete staging. Create a custom-format `pg_dump` and restore it into the second
   empty database using `pg_restore --exit-on-error`. Compare every public table's
   rows, including migration history, and decrypt a recovered item.
8. Delete synthetic accounts in both databases and require empty application
   tables. Stop the cluster and remove its files, dump, personal archive and logs.

A zero exit status and `status: passed` in
`test-results/backup-restore-drill.json` are required. Success is issued only after
cleanup; errors and catchable signals trigger cleanup as well. The generated
report contains counts, statuses, source/script revisions and a dump SHA-256,
never emails, account IDs, connection URLs, tokens, keys, passwords or ciphertext.
Raw logs and backups are private temporary files and are deleted. Do not attach
raw logs or dumps as evidence. A previous report is removed before verification;
a failed run must never be recorded as a successful drill.

If a command fails, the harness reports its phase and exits nonzero. Fix the local
prerequisite/build/test failure and rerun the entire drill. Cleanup failure also
exits nonzero and leaves the private working directory for local recovery.
SIGKILL/power loss cannot run a trap: use the reported local PostgreSQL processes
and `/tmp/vm-drill.*` directories to identify and stop only the abandoned drill
cluster with its `pg_ctl -D <drill-directory>/data -m immediate -w stop`, then remove
that specific directory. Never use a deployment connection to repair a drill.

## Rollback evidence and operational use

[Recorded evidence](evidence/p0-2-backup-restore-drill.json) documents the verified
run. The revision identifies the checkout parent commit; implementation hashes
identify the exact harness and scenario used before the feature commit. Before/after rollback counts are identical; inside-transaction counts prove
that all content types had been inserted before the fault. Successful subsequent
commit and duplicate retries prove that rollback did not poison the saved transfer.

This is a production recovery rehearsal using the current schema and application,
not a backup of the live service. It verifies logical dump recovery and personal
vault recovery locally; it does not measure Neon recovery time, provider PITR,
production scale, Render redeployment or Cloudflare rollback. No live credentials
or real user data are required or permitted by this harness.

Run after backup/schema changes and before releases that affect recovery. Keep the
secret-free report with release evidence. For an actual server-loss incident,
recover a separately managed authorized server backup into an isolated target,
verify it with the matching application revision and migrations before switching
traffic, and retain the original database until acceptance. Never restore over the
only surviving database. Vault key envelope compatibility requires the matching
envelope-aware API/client described in DEPLOYMENT.md. Actual live recovery and
deployment traffic changes remain separate operator actions; this script cannot
perform them. Provider backups and their credentials require separate operational
management. Account security settings are excluded from personal files but included
in server dumps, so those dumps require access control even with encrypted vaults.
