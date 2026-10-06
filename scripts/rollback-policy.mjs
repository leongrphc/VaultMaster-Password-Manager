import { execFileSync } from 'node:child_process';
// P0-5 has no migration. Require byte-identical schema/history and lockfile to
// the pinned target. Any future difference needs a new reviewed compatibility drill.
export function checkRollbackTarget(target, repo) {
  if (target?.schemaVersion !== 1 || !/^[0-9a-f]{40}$/.test(target.gitSha) ||
    target.scope !== 'local-compatible-candidate-only' ||
    target.lastMigration !== '20261006020000_sensitive_action_security') throw new Error('Rollback target is not approved');
  const paths = ['apps/api/prisma', 'pnpm-lock.yaml'];
  const diff = execFileSync('git', ['diff', target.gitSha, '--', ...paths], { cwd: repo, encoding: 'utf8' });
  const staged = execFileSync('git', ['diff', '--cached', target.gitSha, '--', ...paths], { cwd: repo, encoding: 'utf8' });
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '--', ...paths], { cwd: repo, encoding: 'utf8' });
  if (diff || staged || untracked) throw new Error('Schema, migrations or dependencies changed; abort rollback pending compatibility review');
  return target.gitSha;
}
