// Shared API/web policy. Targets bind proofs to the exact method and path.
export function sensitiveAction(method: string, path: string): string | null {
  // Express routers accept case variants and trailing slashes; HEAD can invoke GET.
  path = path.toLowerCase().replace(/\/+$/, '');
  if (method === 'HEAD') method = 'GET';
  if (method === 'POST' && path === '/auth/change-password') return 'security.password.change';
  if (method === 'POST' && path === '/auth/delete-account') return 'security.account.delete';
  if (method === 'POST' && path === '/auth/2fa/setup') return 'security.2fa.setup';
  if (method === 'POST' && path === '/auth/2fa/verify') return 'security.2fa.enable';
  if (method === 'POST' && path === '/auth/2fa/disable') return 'security.2fa.disable';
  if (method === 'POST' && path === '/auth/2fa/recovery-codes/regenerate') return 'security.2fa.recovery_codes.regenerate';
  if (method === 'POST' && path === '/auth/webauthn/registration/options') return 'security.webauthn.setup';
  if (method === 'POST' && path === '/auth/webauthn/registration/verify') return 'security.webauthn.register';
  if (/^\/auth\/webauthn\/credentials\/[^/]+$/.test(path) && ['PATCH', 'DELETE'].includes(method)) return method === 'PATCH' ? 'security.webauthn.rename' : 'security.webauthn.remove';
  if (method === 'POST' && path === '/devices/revoke-others') return 'security.session.revoke_others';
  if (/^\/devices\/[^/]+$/.test(path) && ['PATCH', 'DELETE'].includes(method)) return method === 'PATCH' ? 'security.session.rename' : 'security.session.revoke';
  if (method === 'GET' && path === '/backups/snapshot') return 'vault.backup.export';
  if (method === 'POST' && path === '/auth/export-authorize') return 'vault.export';
  return null;
}

export const SECURITY_MESSAGES: Record<string, string> = {
  'auth.login': 'Yeni bir oturum açıldı. Tanımıyorsanız oturumları kontrol edin.',
  'auth.login.2fa': 'İki adımlı doğrulama ile yeni bir oturum açıldı.',
  'auth.refresh.reuse_detected': 'Oturum yenileme bilgisi tekrar kullanıldı; bu oturum güvenlik için kapatıldı.',
  'security.password.change': 'Ana şifre değiştirildi. Diğer cihazların oturumları kapatıldı; mevcut oturum açık kaldı.',
  'security.2fa.enable': 'İki adımlı doğrulama etkinleştirildi. Kurtarma kodlarını güvenli bir yerde saklayın.',
  'security.2fa.disable': 'İki adımlı doğrulama kapatıldı. Hesabınızın giriş koruması değişti.',
  'security.2fa.recovery_codes.regenerate': 'Yeni kurtarma kodları oluşturuldu. Önceki kodlar artık geçersiz.',
  'security.webauthn.register': 'Yeni bir güvenlik anahtarı eklendi.',
  'security.webauthn.remove': 'Bir güvenlik anahtarı kaldırıldı.',
  'security.webauthn.rename': 'Bir güvenlik anahtarının adı değiştirildi.',
  'security.session.rename': 'Bir cihazın oturum adı değiştirildi.',
  'security.session.revoke': 'Seçilen cihazın oturumu kapatıldı.',
  'security.session.revoke_others': 'Diğer cihazların oturumları kapatıldı; mevcut oturum açık kaldı.',
  'vault.backup.export': 'Şifreli kasa yedeği hazırlandı. Dosyayı ve yedek şifresini güvenli saklayın.',
  'vault.export': 'Kasa dışa aktarma işlemi onaylandı. İndirilen dosyayı güvenli saklayın.',
};
