import { expect, test, vi } from 'vitest';
const init = vi.hoisted(() => vi.fn());
vi.mock('@sentry/nextjs', () => ({ init }));
import { initWebSentry } from '../src/lib/sentry';
test('optional telemetry drops all breadcrumbs, including unrelated URLs and console messages', () => {
  vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'https://fixture@example.test/1');
  try {
    initWebSentry();
    const filter = init.mock.calls[0]![0].beforeBreadcrumb;
    expect(filter({ category: 'fetch', data: { url: 'https://api.pwnedpasswords.com/range/5BAA6' } })).toBeNull();
    const unrelated = { category: 'navigation', data: { to: '/vault/health' } };
    expect(filter(unrelated)).toBeNull();
  } finally { vi.unstubAllEnvs(); }
});
