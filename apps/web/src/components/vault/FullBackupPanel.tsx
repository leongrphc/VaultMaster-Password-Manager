"use client";

import { useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { openFullBackup, countBackup, type BackupArchive } from "@/lib/full-backup";
import { MAX_CHUNKED_BACKUP_FILE_BYTES } from "@vaultmaster/crypto";

export default function FullBackupPanel() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [restorePassword, setRestorePassword] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<BackupArchive | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const previewGuard = useRef<(() => void) | null>(null);
  const inputClass = "w-full rounded-xl border border-border bg-abyss px-4 py-3 text-sm";
  const run = async (operation: () => Promise<void>) => {
    const guard = useStore.getState().getVaultOperationGuard();
    setBusy(true); setMessage(""); setError("");
    try { await operation(); guard(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Yedek işlemi tamamlanamadı."); }
    finally { setBusy(false); }
  };
  const counts = preview ? countBackup(preview.snapshot) : null;
  return <section className="glass rounded-2xl p-6 space-y-5">
    <div><h3 className="font-semibold">Tam Şifreli Kasa Yedeği</h3>
      <p className="mt-1 text-sm text-text-secondary">Klasörler, aktif kayıtlar, çöp kutusu, tüm kayıt geçmişi ve ekler birlikte saklanır. Yeni bir hesaba da geri yüklenebilir.</p>
      <p className="mt-2 text-xs text-text-muted">Yedek şifresini güvenle saklayın; unutulursa dosya açılamaz. Kişisel kasa içindir; hesap oturumları, 2FA ayarları ve paylaşılan kasalar dahil değildir. Kasa içeriği sınırı 64 MiB; eski yedek dosyaları da açılabilir.</p>
    </div>
    <form className="space-y-3" onSubmit={event => {
      event.preventDefault();
      if (password !== confirm) { setError("Yedek şifreleri eşleşmiyor."); return; }
      void run(async () => {
        await useStore.getState().exportFullBackup(password);
        setPassword(""); setConfirm(""); setMessage("Tam şifreli yedek indirildi.");
      });
    }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <input aria-label="Yeni yedek şifresi" type="password" autoComplete="new-password" required minLength={12} value={password} onChange={event => setPassword(event.target.value)} placeholder="Yedek şifresi (en az 12 karakter)" className={inputClass} />
        <input aria-label="Yedek şifresi tekrar" type="password" autoComplete="new-password" required value={confirm} onChange={event => setConfirm(event.target.value)} placeholder="Yedek şifresi (tekrar)" className={inputClass} />
      </div>
      <button disabled={busy} className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-midnight disabled:opacity-50">Tam Yedeği İndir</button>
    </form>
    <div className="border-t border-border pt-5 space-y-3">
      <h4 className="text-sm font-semibold">Tam Yedeği Geri Yükle</h4>
      <p className="text-sm text-text-secondary">Mevcut kayıtlar korunur; yedek ayrı kayıtlar olarak eklenir. Aynı yedek bu hesapta ikinci kez eklenmez.</p>
      <input ref={fileInput} aria-label="Tam yedek dosyası" type="file" accept=".json" disabled={busy} onChange={event => {
        setPreview(null); previewGuard.current = null; setMessage(""); setError("");
        const selected = event.target.files?.[0] ?? null;
        if (selected && selected.size > MAX_CHUNKED_BACKUP_FILE_BYTES) { setFile(null); setError("Yedek dosyası 90 MiB sınırını aşıyor."); }
        else setFile(selected);
      }} className="block w-full text-sm text-text-secondary" />
      <input aria-label="Geri yüklenecek yedeğin şifresi" type="password" autoComplete="off" value={restorePassword} onChange={event => { setRestorePassword(event.target.value); setPreview(null); }} placeholder="Dosyanın yedek şifresi" className={inputClass} />
      <button type="button" disabled={busy || !file || !restorePassword} className="rounded-xl bg-surface px-4 py-2.5 text-sm disabled:opacity-50" onClick={() => void run(async () => {
        const guard = useStore.getState().getVaultOperationGuard();
        const archive = await openFullBackup(await file!.text(), restorePassword);
        guard(); previewGuard.current = guard; setPreview(archive);
      })}>Yedeği Kontrol Et</button>
      {preview && counts && <div className="rounded-xl border border-accent/20 p-4 space-y-3">
        <p className="text-sm">{preview.sourceEmail} · {new Date(preview.exportedAt).toLocaleString("tr-TR")}</p>
        <p className="text-sm text-text-secondary">{counts.folders} klasör · {counts.items - counts.trash} aktif kayıt · {counts.trash} çöp kaydı · {counts.versions} geçmiş sürümü · {counts.attachments} ek</p>
        <button type="button" disabled={busy} className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-midnight disabled:opacity-50" onClick={() => void run(async () => {
          previewGuard.current?.();
          const result = await useStore.getState().restoreFullBackup(preview);
          setPreview(null); previewGuard.current = null; setRestorePassword(""); setFile(null);
          if (fileInput.current) fileInput.current.value = "";
          setMessage(result.alreadyRestored ? "Bu yedek daha önce geri yüklenmiş; kopya eklenmedi." : "Tam yedek başarıyla geri yüklendi.");
        })}>Mevcut Kasaya Ekle</button>
      </div>}
    </div>
    {busy && <p role="status" className="text-sm text-text-secondary">Yedek işleniyor…</p>}
    {message && <p role="status" className="text-sm text-accent">{message}</p>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
  </section>;
}
