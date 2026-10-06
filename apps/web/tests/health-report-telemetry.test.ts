import { expect, test, vi } from 'vitest';
const init = vi.hoisted(() => vi.fn());
vi.mock('@sentry/nextjs', () => ({ init }));
import { initWebSentry } from '../src/lib/sentry';
test('optional telemetry drops provider URLs but preserves unrelated breadcrumbs', () => {
  vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'https://fixture@example.test/1');
  try {
    initWebSentry();
    const filter = init.mock.calls[0]![0].beforeBreadcrumb;
    expect(filter({ category: 'fetch', data: { url: 'https://api.pwnedpasswords.com/range/5BAA6' } })).toBeNull();
    const unrelated = { category: 'navigation', data: { to: '/vault/health' } };
    expect(filter(unrelated)).toBe(unrelated);
  } finally { vi.unstubAllEnvs(); }
});
