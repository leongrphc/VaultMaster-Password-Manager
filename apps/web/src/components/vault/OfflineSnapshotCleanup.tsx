"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { hasOfflineVaultSnapshot, removeOfflineSnapshotForCleanup } from "@/lib/offline-cache";
import { ConfirmModal } from "@/components/ui/Modal";

const explanation = "Yalnızca bu tarayıcıdaki şifreli çevrimdışı kasa kopyası kaldırılır. Sunucudaki kasa, çöp kutusu, geçmiş ve ekler; indirilen yedekler, içe aktarma durumu, oturum, kilit açma bilgileri ve uygulama önbelleği korunur. Açık kasadaki öğeler bellekte kalır. Kopya tam yedek değildir; sonraki senkronizasyon veya değişiklik yeni bir kopya oluşturabilir. Kopya kaldırıldıktan sonra çevrimdışı veri kurtarma için kullanılamaz.";

export default function OfflineSnapshotCleanup() {
  const [present, setPresent] = useState<boolean | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const approval = useRef<(() => void) | null>(null);

  useEffect(() => {
    const refresh = () => {
      try { setPresent(hasOfflineVaultSnapshot()); }
      catch { setPresent(null); }
    };
    refresh();
    window.addEventListener("storage", refresh);
    // Even a lock followed by re-unlock must invalidate this approval.
    const unsubscribe = useStore.subscribe((state, previous) => {
      if (state.lastSyncedAt !== previous.lastSyncedAt) refresh();
      if (state.masterKeyBase64 !== previous.masterKeyBase64 || state.isLocked !== previous.isLocked || state.userId !== previous.userId || state.isAuthenticated !== previous.isAuthenticated) {
        approval.current = null;
        setConfirm(false);
        setMessage("");
        setError("");
      }
    });
    return () => {
      approval.current = null;
      window.removeEventListener("storage", refresh);
      unsubscribe();
    };
  }, []);

  const cancel = () => { approval.current = null; setConfirm(false); };
  const remove = () => {
    const guard = approval.current;
    // Consume the approval before touching storage: double clicks are no-ops.
    cancel();
    if (!guard) return;
    setMessage(""); setError("");
    try {
      guard();
      removeOfflineSnapshotForCleanup();
      setPresent(false);
      setMessage("Bu tarayıcıdaki çevrimdışı kopya kaldırıldı. Kasa ve yedekler korundu.");
    } catch {
      setError("Çevrimdışı kopya kaldırılamadı. Tarayıcı depolama izinlerini ve kasa oturumunu kontrol edip tekrar deneyin.");
    }
  };

  return <section aria-label="Çevrimdışı kopya temizliği" className="glass rounded-2xl p-6 space-y-3">
    <h3 className="font-semibold">Çevrimdışı Kopyayı Temizle</h3>
    <p className="text-sm text-text-secondary">{explanation}</p>
    <p className="text-sm">{present === null ? "Kopya durumu okunamadı." : present ? "Bu tarayıcıda şifreli kopya var." : "Bu tarayıcıda çevrimdışı kopya yok."}</p>
    <button type="button" className="rounded-xl bg-danger/10 px-4 py-2 text-sm text-danger" onClick={() => {
      approval.current = useStore.getState().getVaultOperationGuard();
      setConfirm(true); setMessage(""); setError("");
    }}>Çevrimdışı Kopyayı Kaldır</button>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
    {confirm && <ConfirmModal title="Çevrimdışı kopya kaldırılsın mı?" titleId="offline-cleanup-confirm" description={explanation} confirmLabel="Yalnızca Çevrimdışı Kopyayı Kaldır" onConfirm={remove} onClose={cancel} tone="danger" />}
  </section>;
}
