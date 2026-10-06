import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkRollbackTarget } from '../rollback-policy.mjs';
// P2-2 adds schema/dependency state and closes legacy authorization. Preserve the
// guard: the historical P0-5 compatibility pin must never become an automatic
// fallback. A future independently reviewed replacement must update this gate.
test('client exchange migration blocks the historical rollback artifact without weakening the guard', () => {
  const repo = fileURLToPath(new URL('../../', import.meta.url));
  const target = JSON.parse(readFileSync(new URL('../../docs/rollback-target.json', import.meta.url)));
  assert.ok(existsSync(new URL('../../apps/api/prisma/migrations/20261006030000_client_key_exchange/migration.sql', import.meta.url)));
  assert.throws(() => checkRollbackTarget(target, repo), /Schema, migrations or dependencies changed; abort rollback pending compatibility review/);
});
