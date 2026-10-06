import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { api, ApiError } from '../src/lib/api';
import { useStore } from '../src/lib/store';
import { registerReauthenticationHandler } from '../src/lib/reauthentication';
let unregister: () => void;
const handler = vi.fn(async () => 'operation-proof');
beforeEach(() => {
  handler.mockReset().mockResolvedValue('operation-proof');
  unregister = registerReauthenticationHandler(handler);
  useStore.setState({ isAuthenticated: true, isLocked: false, masterKeyBase64: 'in-memory-test-key', userId: 'user', userEmail: 'user@example.test', currentDeviceId: 'device' });
});
afterEach(() => { unregister(); vi.unstubAllGlobals(); useStore.setState({ isLocked: true, masterKeyBase64: null }); });

test('API attaches one-use proof only to the exact sensitive request and keeps credentials in cookies', async () => {
  const fetchMock = vi.fn<(url: string, options: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  await api.devices.update('device-id', { deviceName: 'New name' }, 'cookie-session');
  expect(handler).toHaveBeenCalledWith({ method: 'PATCH', path: '/devices/device-id', authHash: undefined });
  expect(fetchMock).toHaveBeenCalledWith('/api/devices/device-id', expect.objectContaining({ credentials: 'same-origin', headers: expect.objectContaining({ 'X-VaultMaster-Reauth': 'operation-proof' }) }));
  const headers = fetchMock.mock.calls[0][1].headers;
  expect(headers).not.toHaveProperty('Authorization');
  await api.auth.me('cookie-session');
  expect(handler).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[1][1].headers).not.toHaveProperty('X-VaultMaster-Reauth');
});

test.each([403,429])('HTTP %s fails without replaying the mutation or clearing the session', async status => {
  const fetchMock = vi.fn<(url: string, options: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ success: false, error: 'Denied' }), { status }));
  vi.stubGlobal('fetch', fetchMock);
  await expect(api.auth.authorizeExport('cookie-session')).rejects.toBeInstanceOf(ApiError);
  expect(fetchMock).toHaveBeenCalledTimes(1); expect(handler).toHaveBeenCalledTimes(1);
  expect(useStore.getState().isAuthenticated).toBe(true);
});

test('lock while the dialog is pending prevents the protected network request', async () => {
  let resolve!: (proof: string) => void;
  handler.mockImplementation(() => new Promise<string>(finish => { resolve = finish; }));
  const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
  const pending = api.auth.authorizeExport('cookie-session');
  await vi.waitFor(() => expect(handler).toHaveBeenCalled());
  useStore.getState().lockVault(); resolve('too-late');
  await expect(pending).rejects.toThrow(); expect(fetchMock).not.toHaveBeenCalled();
});
