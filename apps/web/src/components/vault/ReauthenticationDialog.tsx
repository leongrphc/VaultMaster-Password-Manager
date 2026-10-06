"use client";
import { useEffect, useRef, useState } from 'react';
import { startAuthentication } from '@simplewebauthn/browser';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { deriveMasterKey, generateAuthHash } from '@vaultmaster/crypto';
import { Modal } from '@/components/ui/Modal';
import { api, getErrorMessage } from '@/lib/api';
import { useStore } from '@/lib/store';
import { registerReauthenticationHandler, type ReauthenticationRequest } from '@/lib/reauthentication';

type Pending = ReauthenticationRequest & { resolve: (proof: string) => void; reject: (error: Error) => void; guard: () => void };
export default function ReauthenticationDialog() {
  const [pending, setPending] = useState<Pending | null>(null);
  const active = useRef<Pending | null>(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [factorRequired, setFactorRequired] = useState(false);
  const [webAuthn, setWebAuthn] = useState<{ options: PublicKeyCredentialRequestOptionsJSON; challengeToken: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cancel = () => { active.current?.reject(new Error('İşlem iptal edildi.')); active.current = null; setPending(null); setPassword(''); setCode(''); setRecoveryCode(''); };
  useEffect(() => {
    const unregister = registerReauthenticationHandler(request => new Promise((resolve, reject) => {
      if (active.current) { reject(new Error('Önce açık doğrulama işlemini tamamlayın.')); return; }
      const value = { ...request, resolve, reject, guard: useStore.getState().getVaultOperationGuard() };
      active.current = value; setPending(value); setPassword(''); setCode(''); setRecoveryCode(''); setError(''); setBusy(false); setFactorRequired(false); setWebAuthn(null);
    }));
    return () => { unregister(); active.current?.reject(new Error('Kasa oturumu değişti.')); active.current = null; };
  }, []);
  const submit = async (useWebAuthn = false) => {
    if (!pending || busy) return;
    const current = pending;
    setBusy(true); setError('');
    try {
      current.guard();
      const email = useStore.getState().userEmail!;
      const authHash = current.authHash ?? await generateAuthHash(await deriveMasterKey(password, email), password);
      current.guard();
      const webAuthnResponse = useWebAuthn && webAuthn ? await startAuthentication({ optionsJSON: webAuthn.options }) : undefined;
      current.guard();
      const response = await useStore.getState().runWithValidAccessToken(token => api.auth.reauthenticate({ method: current.method, path: current.path, authHash,
        code: code || undefined, recoveryCode: recoveryCode || undefined, webAuthnResponse,
        webAuthnChallengeToken: useWebAuthn ? webAuthn?.challengeToken : undefined }, token));
      current.guard();
      if (active.current !== current) return;
      if (response.data.requires2FA) { setFactorRequired(true); setWebAuthn(response.data.webAuthnOptions ?? null); return; }
      if (!response.data.proof) throw new Error('Kimlik doğrulaması tamamlanamadı.');
      current.resolve(response.data.proof); active.current = null; setPending(null); setPassword(''); setCode(''); setRecoveryCode('');
    } catch (failure) { if (active.current === current) setError(getErrorMessage(failure)); }
    finally { if (active.current === current) setBusy(false); }
  };
  if (!pending) return null;
  return <Modal title="Güvenlik doğrulaması" titleId="reauth-title" onClose={cancel}>
    <form className="space-y-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <p className="text-sm text-text-secondary">Bu hassas işlem için kimliğinizi yeniden doğrulayın. Onay yalnızca bu işlem ve cihaz için bir kez kullanılabilir.</p>
      {!pending.authHash && <input aria-label="Ana şifre" autoComplete="current-password" type="password" required value={password} onChange={event => setPassword(event.target.value)} className="w-full rounded-xl bg-abyss p-3" />}
      {factorRequired && <>
        <p>Etkin giriş doğrulama yönteminizle devam edin.</p>
        <input aria-label="Doğrulama kodu" autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} className="w-full rounded-xl bg-abyss p-3" />
        <input aria-label="Kurtarma kodu" autoComplete="off" value={recoveryCode} onChange={event => setRecoveryCode(event.target.value)} className="w-full rounded-xl bg-abyss p-3" />
        {webAuthn && <button type="button" disabled={busy} onClick={() => void submit(true)}>Güvenlik anahtarıyla doğrula</button>}
      </>}
      {error && <p role="alert" className="text-danger">{error}</p>}
      <div className="flex gap-3"><button type="button" onClick={cancel}>Vazgeç</button><button disabled={busy} className="rounded-xl bg-accent p-3 text-midnight">{busy ? 'Doğrulanıyor…' : 'Doğrula ve devam et'}</button></div>
    </form>
  </Modal>;
}
