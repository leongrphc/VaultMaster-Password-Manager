import { afterEach, expect, test, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { observe } from '../src/lib/observability';
import { api } from '../src/lib/api';
import { safeTelemetryEvent } from '@vaultmaster/shared';
const capture = vi.hoisted(() => vi.fn());
vi.mock('@sentry/nextjs', () => ({ captureMessage: capture, init: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); capture.mockClear(); });
test('local and optional telemetry events discard raw exception/context/response identifiers', async () => {
  vi.stubGlobal('crypto', webcrypto); vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'synthetic');
  const lines: string[] = []; vi.spyOn(console, 'info').mockImplementation(line => lines.push(line));
  const secret = 'sentinel-password-token-ciphertext@example.test';
  observe('sync_result', { operation: 'sync', outcome: 'failure', error: new Error(secret), requestId: secret,
    password: secret, token: secret, path: secret, encryptedData: secret, userId: secret });
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(secret)));
  await expect(api.vault.getAll(secret)).rejects.toThrow();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'fixed', requestId: secret }), { status: 500 })));
  try { await api.vault.getAll(secret); } catch (error) { expect((error as { requestId?: string }).requestId).toBeUndefined(); }
  const result = lines.join('') + JSON.stringify(capture.mock.calls);
  expect(result).not.toContain(secret);
  expect(lines.map(line => JSON.parse(line).reason)).toContain('network');
  for (const call of capture.mock.calls) expect(safeTelemetryEvent({ message: call[0], extra: call[1].extra })).not.toBeNull();
});
test('invalid success JSON is observable and fails rather than silently succeeding', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('secret-invalid-response')));
  await expect(api.vault.getAll('synthetic')).rejects.toThrow('Sunucudan geçersiz');
  expect(JSON.parse(spy.mock.calls[0]![0]).reason).toBe('invalid_response');
});
