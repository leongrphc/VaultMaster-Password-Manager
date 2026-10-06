import test from 'node:test';
import assert from 'node:assert/strict';
import { passwordRange, matchPasswordRange } from '../dist/index.js';

test('HIBP SHA-1 range splits the known digest and matches exact suffixes including padding', async () => {
  const range = await passwordRange('password');
  assert.deepEqual(range, { prefix: '5BAA6', suffix: '1E4C9B93F3F0682250B6CF8331B7EE68FD8' });
  assert.equal(matchPasswordRange(`${'0'.repeat(35)}:0\r\n${range.suffix}:42\r\n`, range.suffix), 42);
  assert.equal(matchPasswordRange(`${'0'.repeat(35)}:0`, range.suffix), 0);
  assert.notEqual((await passwordRange(' password')).suffix, range.suffix);
});
test('malformed, duplicated and oversized provider data cannot mean safe', () => {
  const suffix = 'A'.repeat(35);
  for (const text of ['', 'upstream private error', `${suffix}:NaN`, `${suffix}:9007199254740992`, `${suffix}:1\n${suffix}:2`, `${suffix}:1junk`, 'A'.repeat(2_000_001)]) {
    assert.throws(() => matchPasswordRange(text, suffix), /Invalid range response/);
  }
  assert.throws(() => matchPasswordRange(`${suffix}:1`, 'A'), /Invalid range response/);
});
