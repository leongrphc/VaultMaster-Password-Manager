import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import ReauthenticationDialog from '../src/components/vault/ReauthenticationDialog';
import SecurityNotifications from '../src/components/vault/SecurityNotifications';
import { requestReauthentication } from '../src/lib/reauthentication';
import { api } from '../src/lib/api';

const guard = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/store', () => ({ useStore: { getState: () => ({ userEmail: 'fixture@example.test', getVaultOperationGuard: () => guard, runWithValidAccessToken: (operation: (token: string) => unknown) => operation('cookie-session') }) } }));
vi.mock('@vaultmaster/crypto', () => ({ deriveMasterKey: vi.fn(async () => 'password-key'), generateAuthHash: vi.fn(async () => 'auth-proof-only') }));
vi.mock('../src/lib/api', () => ({ api: { auth: { reauthenticate: vi.fn(), securityNotifications: vi.fn(), readSecurityNotification: vi.fn() } }, getErrorMessage: (error: Error) => error.message }));
vi.mock('@simplewebauthn/browser', () => ({ startAuthentication: vi.fn(async () => ({ signed: 'assertion' })) }));
beforeEach(() => { vi.resetAllMocks(); guard.mockImplementation(() => {}); localStorage.clear(); });
afterEach(cleanup);
const begin = () => requestReauthentication({ method: 'POST', path: '/auth/export-authorize' });

test('dialog submits password proof for one target and clears secrets after success', async () => {
  vi.mocked(api.auth.reauthenticate).mockResolvedValue({ data: { proof: 'single-use-proof' } });
  render(<ReauthenticationDialog />);
  let pending!: Promise<string>;
  await waitFor(() => { pending = begin(); expect(pending).toBeDefined(); });
  await userEvent.type(await screen.findByLabelText('Ana şifre'), 'private-password');
  await userEvent.click(screen.getByText('Doğrula ve devam et'));
  expect(await pending).toBe('single-use-proof');
  expect(api.auth.reauthenticate).toHaveBeenCalledWith(expect.objectContaining({ method: 'POST', path: '/auth/export-authorize', authHash: 'auth-proof-only' }), 'cookie-session');
  expect(screen.queryByLabelText('Ana şifre')).toBeNull();
  expect(JSON.stringify(localStorage)).not.toContain('private-password');
  expect(JSON.stringify(vi.mocked(api.auth.reauthenticate).mock.calls)).not.toContain('private-password');
});

test('failure keeps the action pending, requires MFA, and recovery success closes the dialog', async () => {
  vi.mocked(api.auth.reauthenticate).mockResolvedValueOnce({ data: { requires2FA: true } }).mockRejectedValueOnce(new Error('Kimlik doğrulaması başarısız.')).mockResolvedValueOnce({ data: { proof: 'fresh-proof' } });
  render(<ReauthenticationDialog />);
  const pending = begin();
  await userEvent.type(await screen.findByLabelText('Ana şifre'), 'private-password');
  await userEvent.click(screen.getByText('Doğrula ve devam et'));
  await userEvent.type(await screen.findByLabelText('Kurtarma kodu'), 'recovery-secret');
  await userEvent.click(screen.getByText('Doğrula ve devam et'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Kimlik doğrulaması başarısız.');
  await userEvent.click(screen.getByText('Doğrula ve devam et'));
  expect(await pending).toBe('fresh-proof');
  expect(screen.queryByLabelText('Kurtarma kodu')).toBeNull();
});

test('cancel and lock during verification prevent approval', async () => {
  render(<ReauthenticationDialog />);
  const cancelled = begin(); const rejection = expect(cancelled).rejects.toThrow('iptal');
  await screen.findByLabelText('Ana şifre'); await userEvent.click(screen.getByText('Vazgeç')); await rejection;
  const locked = begin(); const lockRejection = expect(locked).rejects.toThrow('iptal');
  await userEvent.type(await screen.findByLabelText('Ana şifre'), 'private-password');
  guard.mockImplementation(() => { throw new Error('Kasa kilitlendi.'); });
  await userEvent.click(screen.getByText('Doğrula ve devam et'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Kasa kilitlendi.');
  expect(api.auth.reauthenticate).not.toHaveBeenCalled();
  await userEvent.click(screen.getByText('Vazgeç')); await lockRejection;
});

test('security inbox shows effect text, acknowledgement and errors without inventing success', async () => {
  const notification = { id: 'notification-1', action: 'security.password.change', message: 'Ana şifre değiştirildi. Diğer cihazların oturumları kapatıldı; mevcut oturum açık kaldı.', createdAt: '2026-10-06T00:00:00Z', readAt: null };
  vi.mocked(api.auth.securityNotifications).mockResolvedValueOnce({ data: [notification] }).mockResolvedValueOnce({ data: [{ ...notification, readAt: '2026-10-06T00:01:00Z' }] }).mockRejectedValueOnce(new Error('Bildirimler yüklenemedi.'));
  vi.mocked(api.auth.readSecurityNotification).mockResolvedValue({ success: true });
  render(<SecurityNotifications />);
  expect(await screen.findByText(notification.message)).toBeVisible();
  await userEvent.click(screen.getByText('Okundu olarak işaretle'));
  await waitFor(() => expect(screen.queryByText('Okundu olarak işaretle')).toBeNull());
  expect(api.auth.readSecurityNotification).toHaveBeenCalledWith('notification-1','cookie-session');
  await userEvent.click(screen.getByText('Yenile'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Bildirimler yüklenemedi.');
});
