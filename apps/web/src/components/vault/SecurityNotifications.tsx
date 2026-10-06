"use client";
import { useCallback, useEffect, useState } from 'react';
import { api, getErrorMessage, type SecurityNotification } from '@/lib/api';
import { useStore } from '@/lib/store';

export default function SecurityNotifications() {
  const [rows, setRows] = useState<SecurityNotification[]>([]);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try {
      const guard = useStore.getState().getVaultOperationGuard();
      const response = await useStore.getState().runWithValidAccessToken(token => api.auth.securityNotifications(token));
      guard(); setRows(response.data); setError('');
    } catch (failure) { setError(getErrorMessage(failure)); }
  }, []);
  useEffect(() => { const initial = setTimeout(() => void refresh(), 0); const timer = setInterval(() => void refresh(), 30000); return () => { clearTimeout(initial); clearInterval(timer); }; }, [refresh]);
  return <section className="glass rounded-2xl p-6 space-y-3" aria-label="Güvenlik bildirimleri">
    <h3 className="font-semibold">Güvenlik Bildirimleri</h3>
    <p className="text-sm text-text-secondary">Son 50 güvenlik değişikliği. Tanımadığınız bir işlem varsa oturumları kapatın ve ana şifrenizi değiştirin.</p>
    <button type="button" onClick={() => void refresh()}>Yenile</button>
    {error && <p role="alert">{error}</p>}
    {!error && rows.length === 0 && <p>Henüz güvenlik bildirimi yok.</p>}
    <ul className="space-y-3">{rows.map(row => <li key={row.id} className="rounded-xl border border-border p-3">
      <p>{row.message}</p><time className="text-xs text-text-secondary" dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleString('tr-TR')}</time>
      {!row.readAt && <button className="ml-3 text-sm text-accent" onClick={() => void (async () => {
        try { await useStore.getState().runWithValidAccessToken(token => api.auth.readSecurityNotification(row.id, token)); await refresh(); }
        catch (failure) { setError(getErrorMessage(failure)); }
      })()}>Okundu olarak işaretle</button>}
    </li>)}</ul>
  </section>;
}
