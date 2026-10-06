import { act, render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import HealthReportPage from '../src/app/vault/health/page';
import { checkPasswordBreaches, type HealthProgress } from '../src/lib/health-report';

const fixture = vi.hoisted(() => {
  const items = [{ id: '1', data: { type: 'login', title: 'PRIVATE TITLE', username: 'PRIVATE USER', url: 'https://private.test', password: 'password' } },
    { id: '2', data: { type: 'login', title: 'PRIVATE TITLE 2', username: 'PRIVATE USER 2', password: 'password' } }];
  return { items, state: { items, isLocked: false, isAuthenticated: true, masterKeyBase64: 'fixture', userId: 'fixture' }, listeners: new Set<(state: unknown, previous: unknown) => void>() };
});
vi.mock('../src/lib/store', () => ({ useStore: Object.assign((selector: (state: typeof fixture.state) => unknown) => selector(fixture.state), {
  getState: () => ({ ...fixture.state, getVaultOperationGuard: () => () => { if (fixture.state.isLocked) throw new Error('locked'); } }),
  subscribe: (listener: (state: unknown, previous: unknown) => void) => { fixture.listeners.add(listener); return () => fixture.listeners.delete(listener); },
}) }));
const suffix = '1E4C9B93F3F0682250B6CF8331B7EE68FD8';
const response = (count = 3) => ({ ok: true, text: async () => `${suffix}:${count}` });
beforeEach(() => { fixture.state = { ...fixture.state, items: fixture.items, isLocked: false }; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

test('counts validated matches only; progress and privacy copy omit credentials and metadata', async () => {
  let resolve!: (value: unknown) => void;
  const fetcher = vi.fn().mockResolvedValueOnce(response()).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  vi.stubGlobal('fetch', fetcher);
  render(<HealthReportPage />);
  expect(fetcher).not.toHaveBeenCalled();
  expect(screen.getByText(/IP adresinizi/)).toBeVisible();
  expect(screen.queryByText(/PRIVATE/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Kontrol Et' }));
  await screen.findByText('1 / 2 şifre kontrol edildi');
  expect(screen.getByRole('progressbar', { name: 'Geçerli aşama; süre bilinmiyor' })).not.toHaveAttribute('value');
  expect(screen.queryByText(/kontrolü tamamlandı/)).not.toBeInTheDocument();
  expect(screen.queryByText(/kez sızdırılmış/)).not.toBeInTheDocument();
  await act(async () => resolve(response()));
  await screen.findByText(/kontrolü tamamlandı/);
  expect(screen.getAllByText('3 kez sızdırılmış')).toHaveLength(2);
  expect(fetcher.mock.calls[0][1]).toMatchObject({ headers: { 'Add-Padding': 'true' }, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', redirect: 'error' });
});

test('duplicate cancellation and late response cannot publish over a restarted report', async () => {
  let late!: (value: unknown) => void;
  const fetcher = vi.fn().mockImplementationOnce(() => new Promise(done => { late = done; })).mockResolvedValue(response(0));
  vi.stubGlobal('fetch', fetcher);
  render(<HealthReportPage />);
  await userEvent.click(screen.getByRole('button', { name: 'Kontrol Et' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  const cancel = screen.getByRole('button', { name: 'İptal' });
  act(() => { cancel.click(); cancel.click(); });
  expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(true);
  expect(screen.getByText(/Kontrol iptal edildi/)).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Kontrol Et' }));
  await screen.findByText(/kontrolü tamamlandı/);
  await act(async () => late(response(99)));
  expect(screen.queryByText(/99 kez/)).not.toBeInTheDocument();
  expect(screen.getByText('2 / 2 şifre kontrol edildi')).toBeVisible();
});

test.each(['unmount', 'lock', 'items'])('%s aborts requests and rejects late results', async mode => {
  let late!: (value: unknown) => void;
  const fetcher = vi.fn<(url: string, init: RequestInit) => Promise<unknown>>(() => new Promise(done => { late = done; }));
  vi.stubGlobal('fetch', fetcher);
  const view = render(<HealthReportPage />);
  await userEvent.click(screen.getByRole('button', { name: 'Kontrol Et' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  if (mode === 'unmount') view.unmount();
  else act(() => {
    const previous = fixture.state;
    fixture.state = { ...previous, ...(mode === 'lock' ? { isLocked: true } : { items: [...previous.items] }) };
    for (const listener of fixture.listeners) listener(fixture.state, previous);
  });
  expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(true);
  await act(async () => late(response(99)));
  expect(screen.queryByText(/99 kez/)).not.toBeInTheDocument();
});

test('HTTP or malformed responses fail closed, discard partial results and allow retry', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response()).mockResolvedValueOnce({ ok: false, text: async () => 'PRIVATE SERVER ERROR' }).mockResolvedValue(response(0));
  vi.stubGlobal('fetch', fetcher);
  render(<HealthReportPage />);
  await userEvent.click(screen.getByRole('button', { name: 'Kontrol Et' }));
  await screen.findByText(/Kontrol tamamlanamadı/);
  expect(screen.getByText('1 / 2 şifre kontrol edildi')).toBeVisible();
  expect(screen.queryByText(/kez sızdırılmış/)).not.toBeInTheDocument();
  expect(screen.queryByText(/PRIVATE/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Kontrol Et' }));
  await screen.findByText(/kontrolü tamamlandı/);
});

test('aborting during digest prevents any network request; timeout cleans up and is an error', async () => {
  let digestDone!: (value: ArrayBuffer) => void;
  vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(() => new Promise(done => { digestDone = done; }));
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  const controller = new AbortController();
  const phases: HealthProgress[] = [];
  const run = checkPasswordBreaches([{ id: '1', password: 'password' }], controller.signal, () => {}, value => phases.push(value));
  const rejection = expect(run).rejects.toThrow('Breach check unavailable');
  controller.abort(); digestDone(new Uint8Array(20).buffer);
  await rejection;
  expect(fetcher).not.toHaveBeenCalled();
  vi.useFakeTimers();
  try {
    vi.restoreAllMocks();
    fetcher.mockImplementation((_url, init) => new Promise((_done, reject) => init.signal.addEventListener('abort', () => reject(new Error('PRIVATE ERROR')))));
    const run2 = checkPasswordBreaches([{ id: '1', password: 'password' }], new AbortController().signal, () => {}, value => phases.push(value));
    const rejected = expect(run2).rejects.toThrow('Breach check unavailable');
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(15_000);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});
