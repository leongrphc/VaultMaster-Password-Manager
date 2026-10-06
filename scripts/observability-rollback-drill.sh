#!/usr/bin/env bash
# Provision only our own local Unix-socket cluster. No deployment URL is accepted.
set -euo pipefail
[[ $# == 0 ]] || { echo 'This drill accepts no database URLs or arguments.' >&2; exit 1; }
exec env -i PATH="$PATH" bash --noprofile --norc -s -- "$0" <<'DRILL'
set -euo pipefail
umask 077
repo=$(cd "$(dirname "$1")/.." && pwd)
report="$repo/test-results/observability-rollback-drill.json"
# A failed prerequisite must not leave a previous success report behind.
rm -f "$report"
pgbin=$(pg_config --bindir)
for tool in initdb pg_ctl createdb pg_dump pg_restore; do
  [[ -x "$pgbin/$tool" ]] || { echo "Missing PostgreSQL tool: $tool" >&2; exit 1; }
done
command -v pnpm >/dev/null
work=$(mktemp -d /tmp/vm-drill.XXXXXXXX)
pg_run=()
stage=provision
cleanup() {
  result=$?
  trap - EXIT
  if "${pg_run[@]}" "$pgbin/pg_ctl" -D "$work/data" status >/dev/null 2>&1; then
    if ! "${pg_run[@]}" "$pgbin/pg_ctl" -D "$work/data" -m immediate -w stop >>"$work/commands.log" 2>&1; then
      echo 'Cluster cleanup failed; evidence cannot be marked complete.' >&2
      exit 1
    fi
  fi
  rm -rf -- "$work"
  if [[ $result == 0 ]]; then
    node - "$report" <<'JS'
const fs = require('node:fs');
const path = process.argv[2];
const report = JSON.parse(fs.readFileSync(path));
report.cleanup = { accountsAndTransfers: 'verified-empty', cluster: 'stopped', temporaryFiles: 'removed' };
report.status = 'passed';
fs.writeFileSync(path, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
JS
    echo "Drill passed; secret-free evidence: $report"
  else
    echo "Drill failed during $stage; temporary cluster/files removed. No successful evidence issued." >&2
  fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir -p "$repo/test-results" "$work/socket" "$work/runtime/work" "$work/home"
export XDG_CONFIG_HOME="$work/home" npm_config_userconfig="$work/home/npmrc"
if [[ $(id -u) == 0 ]]; then
  id postgres >/dev/null
  chown -R postgres "$work"
  pg_run=(runuser -u postgres --)
fi
# A unique socket directory and disabled TCP prevent reaching any existing server.
"${pg_run[@]}" "$pgbin/initdb" -D "$work/data" -U drill --auth-local=trust --auth-host=reject --no-locale >>"$work/commands.log" 2>&1
"${pg_run[@]}" "$pgbin/pg_ctl" -D "$work/data" -l "$work/postgres.log" -o "-k $work/socket -c listen_addresses='' -c unix_socket_permissions=0700" -w start >>"$work/commands.log" 2>&1
"$pgbin/createdb" -h "$work/socket" -U drill drill_source
"$pgbin/createdb" -h "$work/socket" -U drill drill_recovered
export DATABASE_URL="postgresql://drill@localhost/drill_source?host=$work/socket"
export DATABASE_DIRECT_URL="$DATABASE_URL"
export VAULTMASTER_TEST_DATABASE_URL="$DATABASE_URL"
export VAULTMASTER_TEST_DATABASE_DIRECT_URL="$DATABASE_URL"
export NODE_ENV=test
export JWT_SECRET=synthetic-drill-access-secret-00000000
export JWT_REFRESH_SECRET=synthetic-drill-refresh-secret-0000000
export APP_ENCRYPTION_KEY=Iqgdnj6zTOno1qTzP6+46sh4Vhvs13bWVeLD5TbLWXA=
export CORS_ORIGIN=http://localhost:3000
export VM_DRILL_WORK="$work" VM_DRILL_PGBIN="$pgbin" VM_DRILL_REPORT="$report"
cd "$repo"
stage=build
pnpm --filter @vaultmaster/api db:generate >>"$work/commands.log" 2>&1
pnpm --filter @vaultmaster/api... build >>"$work/commands.log" 2>&1
pnpm --filter @vaultmaster/crypto build >>"$work/commands.log" 2>&1
stage=migrations
pnpm --filter @vaultmaster/api db:deploy >>"$work/commands.log" 2>&1
stage=regression
cd "$work/runtime/work"
node --test --experimental-test-isolation=none "$repo"/apps/api/tests/*.test.mjs >>"$work/commands.log" 2>&1
stage=verification
node "$repo/scripts/observability-rollback-drill.mjs" >>"$work/commands.log" 2>&1

DRILL
