"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  ChevronRight,
  Repeat2,
  Zap,
  Globe,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { checkPasswordBreaches, type HealthProgress } from "@/lib/health-report";
import { calculateStrength, getStrengthLabel } from "@vaultmaster/crypto";

interface PasswordIssue {
  itemId: string;
  issues: string[];
  strength: number;
  strengthLabel: string;
}

interface DuplicateGroup {
  items: { id: string }[];
}

export default function HealthReportPage() {
  const items = useStore((state) => state.items);
  const [report, setReport] = useState<{ source: typeof items; results: Record<string, number> } | null>(null);
  const checkedBreaches = report?.source === items ? report.results : {};
  const [breachProgress, setBreachProgress] = useState<HealthProgress>({ phase: "idle", completed: 0, total: 0 });
  const active = useRef<AbortController | null>(null);
  const checkingBreaches = ["hashing", "requesting", "matching"].includes(breachProgress.phase);

  useEffect(() => {
    const unsubscribe = useStore.subscribe((state, previous) => {
      if (state.items !== previous.items || state.masterKeyBase64 !== previous.masterKeyBase64 ||
          state.userId !== previous.userId || state.isLocked !== previous.isLocked ||
          state.isAuthenticated !== previous.isAuthenticated) {
        active.current?.abort(); active.current = null;
        setReport(null);
        setBreachProgress({ phase: "idle", completed: 0, total: 0 });
      }
    });
    return () => { unsubscribe(); active.current?.abort(); active.current = null; };
  }, []);

  const loginItems = useMemo(
    () => items.filter((i) => i.data.type === "login").map((i) => ({
      ...i,
      data: i.data as Extract<typeof i.data, { type: "login" }>,
    })),
    [items]
  );

  // Zayıf şifre analizi
  const weakPasswords = useMemo<PasswordIssue[]>(() => {
    return loginItems
      .map((item) => {
        const pw = item.data.password;
        const strength = calculateStrength(pw);
        const label = getStrengthLabel(strength);
        const issues: string[] = [];

        if (pw.length < 8) issues.push("8 karakterden kısa");
        if (pw.length < 12) issues.push("12 karakterden kısa");
        if (!/[A-Z]/.test(pw)) issues.push("Büyük harf yok");
        if (!/[a-z]/.test(pw)) issues.push("Küçük harf yok");
        if (!/[0-9]/.test(pw)) issues.push("Rakam yok");
        if (!/[^A-Za-z0-9]/.test(pw)) issues.push("Özel karakter yok");

        if (strength < 60 || issues.length > 0) {
          return {
            itemId: item.id,
            issues,
            strength,
            strengthLabel: label,
          };
        }
        return null;
      })
      .filter(Boolean) as PasswordIssue[];
  }, [loginItems]);

  // Tekrar eden şifreler
  const duplicates = useMemo<DuplicateGroup[]>(() => {
    const pwMap = new Map<string, { id: string }[]>();

    loginItems.forEach((item) => {
      const pw = item.data.password;
      if (!pwMap.has(pw)) pwMap.set(pw, []);
      pwMap.get(pw)!.push({
        id: item.id,
      });
    });

    return Array.from(pwMap.entries())
      .filter(([, items]) => items.length > 1)
      .map(([, items]) => ({ items }));
  }, [loginItems]);

  const checkBreaches = async () => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setReport(null);
    setBreachProgress({ phase: "hashing", completed: 0, total: loginItems.length });
    const current = () => {
      if (active.current !== controller || useStore.getState().items !== items) throw new Error("Report invalidated");
      guard();
    };
    let guard: () => void;
    try {
      guard = useStore.getState().getVaultOperationGuard();
      const results = await checkPasswordBreaches(loginItems.map(item => ({ id: item.id, password: item.data.password })),
        controller.signal, current, setBreachProgress);
      current();
      setReport({ source: items, results });
      setBreachProgress({ phase: "completed", completed: loginItems.length, total: loginItems.length });
    } catch {
      if (active.current === controller) setBreachProgress(progress => ({ ...progress, phase: "error" }));
    } finally {
      if (active.current === controller) active.current = null;
    }
  };

  const cancelBreachCheck = () => {
    const controller = active.current;
    if (!controller) return;
    active.current = null;
    controller.abort();
    setReport(null);
    setBreachProgress(progress => ({ ...progress, phase: "cancelled" }));
  };

  const breachedItems = Object.entries(checkedBreaches).filter(
    ([, count]) => count !== null && count > 0
  );

  // Toplam skor hesaplama
  const totalLogins = loginItems.length;
  const weakCount = weakPasswords.length;
  const dupCount = duplicates.reduce((acc, g) => acc + g.items.length, 0);
  const breachedCount = breachedItems.length;

  const overallScore =
    totalLogins === 0
      ? 100
      : Math.max(
          0,
          Math.round(
            100 - (weakCount / totalLogins) * 40 - (dupCount / totalLogins) * 30 - (breachedCount / totalLogins) * 30
          )
        );

  const scoreColor =
    overallScore >= 80 ? "#00ffb2" : overallScore >= 60 ? "#ffb020" : overallScore >= 40 ? "#ff8c42" : "#ff4d6a";

  const strengthColors: Record<string, string> = {
    weak: "#ff4d6a",
    fair: "#ff8c42",
    good: "#ffb020",
    strong: "#00cc8e",
    excellent: "#00ffb2",
  };

  const breachProgressPercent = breachProgress.total > 0
    ? Math.round((breachProgress.completed / breachProgress.total) * 100)
    : 0;

  if (totalLogins === 0) {
    return (
      <div className="max-w-4xl mx-auto">
        <h2 className="text-2xl font-bold mb-8 font-[family-name:var(--font-display)]">
          Şifre Sağlık Raporu
        </h2>
        <div className="glass rounded-2xl p-16 text-center">
          <ShieldCheck className="w-12 h-12 text-text-muted mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">Analiz edecek giriş bilgisi yok</h3>
          <p className="text-text-secondary text-sm">Kasanıza giriş bilgileri ekledikten sonra sağlık raporu burada görünecek.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <h2 className="text-2xl font-bold mb-8 font-[family-name:var(--font-display)]">
        Şifre Sağlık Raporu
      </h2>

      {/* Genel Skor */}
      <div className="glass rounded-2xl p-8 mb-6 flex items-center gap-8">
        <div className="relative w-32 h-32 shrink-0">
          <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
            <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="6" className="text-surface" />
            <circle
              cx="50" cy="50" r="42" fill="none" stroke={scoreColor} strokeWidth="6"
              strokeDasharray={`${overallScore * 2.64} ${264 - overallScore * 2.64}`}
              strokeLinecap="round"
              style={{ transition: "stroke-dasharray 1s ease" }}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-3xl font-bold font-[family-name:var(--font-mono)]" style={{ color: scoreColor }}>
              {overallScore}
            </span>
          </div>
        </div>

        <div className="flex-1">
          <h3 className="text-xl font-bold mb-1">
            {overallScore >= 80 ? "Yerel kontroller iyi" : overallScore >= 50 ? "İyileştirme gerekli" : "Acil aksiyon gerekiyor"}
          </h3>
          <p className="text-text-secondary text-sm mb-4">
            {totalLogins} giriş bilgisi yerel olarak analiz edildi. Sızıntı kontrolü ayrı ve isteğe bağlıdır; bu puan güvenlik garantisi değildir.
          </p>

          <div className="grid grid-cols-3 gap-3">
            <div className="bg-surface rounded-xl p-3 text-center">
              <p className="text-2xl font-bold" style={{ color: weakCount > 0 ? "#ff4d6a" : "#00ffb2" }}>
                {weakCount}
              </p>
              <p className="text-xs text-text-muted mt-1">Zayıf Şifre</p>
            </div>
            <div className="bg-surface rounded-xl p-3 text-center">
              <p className="text-2xl font-bold" style={{ color: dupCount > 0 ? "#ffb020" : "#00ffb2" }}>
                {duplicates.length}
              </p>
              <p className="text-xs text-text-muted mt-1">Tekrar Eden</p>
            </div>
            <div className="bg-surface rounded-xl p-3 text-center">
              <p className="text-2xl font-bold" style={{ color: breachedCount > 0 ? "#ff4d6a" : "#00ffb2" }}>
                {breachedCount > 0 ? breachedCount : report?.source === items ? "0" : "?"}
              </p>
              <p className="text-xs text-text-muted mt-1">Sızdırılmış</p>
            </div>
          </div>
        </div>
      </div>

      {/* HIBP Kontrol */}
      <div className="glass rounded-2xl p-6 mb-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-danger/10 flex items-center justify-center shrink-0">
              <ShieldAlert className="w-5 h-5 text-danger" />
            </div>
            <div>
              <h3 className="font-semibold">Sızıntı Kontrolü</h3>
              <p className="text-sm text-text-secondary">
                Zayıflık ve tekrar analizi cihazınızda yapılır. Sızıntı kontrolü yalnızca Kontrol Et ile başlar.
                Şifreler tarayıcınızda SHA-1 ile özetlenir; HIBP&apos;ye yalnızca ilk 5 hash karakteri gönderilir.
                Tam hash, düz metin şifre, kayıt adı, kullanıcı adı ve URL gönderilmez; eşleşme yerel olarak yapılır.
                HIBP IP adresinizi, istek zamanını ve hash önekini görebilir; ağ sağlayıcıları bağlantı bilgilerini görebilir. Bu tam anonimlik sağlamaz.
                Çerez ve yönlendiren adres gönderilmez; yanıt dolgusu istenir. Sonuçlar kaydedilmez ve sayfadan ayrılınca silinir.
                İptal yeni istekleri durdurur ve kısmi sonuçları siler; gönderilmiş bir isteği geri alamaz. Kasanız değiştirilmez. Rapor satırları yalnızca kayıt numarası gösterir.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={checkBreaches}
              disabled={checkingBreaches}
              className="bg-danger/10 hover:bg-danger/20 text-danger font-medium px-5 py-2.5 rounded-xl flex items-center gap-2 transition-all text-sm disabled:opacity-50"
            >
              {checkingBreaches ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Kontrol ediliyor...
                </>
              ) : (
                <>
                  <ShieldAlert className="w-4 h-4" />
                  Kontrol Et
                </>
              )}
            </button>
            {checkingBreaches && (
              <button
                onClick={cancelBreachCheck}
                className="bg-surface hover:bg-surface-hover text-text-secondary font-medium px-4 py-2.5 rounded-xl transition-all text-sm"
              >
                İptal
              </button>
            )}
          </div>
        </div>

        {breachProgress.phase !== "idle" && (
          <div className="mt-4 rounded-xl border border-accent/20 bg-accent/5 p-3">
            <p role="status" className="text-sm text-text-secondary">
              {breachProgress.phase === "hashing" && "Özet cihazınızda hazırlanıyor…"}
              {breachProgress.phase === "requesting" && "HIBP yanıtı bekleniyor; kalan süre bilinmiyor…"}
              {breachProgress.phase === "matching" && "Yanıt cihazınızda eşleştiriliyor…"}
              {breachProgress.phase === "completed" && "Sızıntı kontrolü tamamlandı. Eşleşme olmaması güvenlik garantisi değildir."}
              {breachProgress.phase === "cancelled" && "Kontrol iptal edildi; kısmi sonuçlar silindi."}
              {breachProgress.phase === "error" && "Kontrol tamamlanamadı; sonuçlar silindi. Yeniden deneyin."}
            </p>
            <p className="text-xs text-text-secondary my-2">{breachProgress.completed} / {breachProgress.total} şifre kontrol edildi</p>
            <progress aria-label="Sızıntı kontrolü ilerlemesi" max={breachProgress.total || 1} value={breachProgress.completed} className="w-full" />
            {checkingBreaches && <progress aria-label="Geçerli aşama; süre bilinmiyor" className="w-full" />}
            {breachProgress.phase === "completed" && <p className="text-xs">{breachProgressPercent}%</p>}
          </div>
        )}

        {breachedItems.length > 0 && (
          <div className="mt-4 space-y-2">
            {breachedItems.map(([itemId, count]) => {
              const item = loginItems.find((i) => i.id === itemId);
              if (!item) return null;
              return (
                <div key={itemId} className="flex items-center gap-3 bg-danger/5 border border-danger/20 rounded-xl p-3">
                  <AlertTriangle className="w-4 h-4 text-danger shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">Kayıt {loginItems.findIndex(entry => entry.id === item.id) + 1}</p>
                  </div>
                  <span className="text-xs text-danger font-mono shrink-0">
                    {(count as number).toLocaleString()} kez sızdırılmış
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Zayıf Şifreler */}
      {weakPasswords.length > 0 && (
        <div className="glass rounded-2xl p-6 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-warning/10 flex items-center justify-center">
              <Zap className="w-5 h-5 text-warning" />
            </div>
            <div>
              <h3 className="font-semibold">Zayıf Şifreler ({weakPasswords.length})</h3>
              <p className="text-sm text-text-secondary">Bu şifrelerin güçlendirilmesi önerilir</p>
            </div>
          </div>

          <div className="space-y-2">
            {weakPasswords.map((item) => (
              <div key={item.itemId} className="flex items-center gap-3 bg-surface rounded-xl p-3 group">
                <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
                  <Globe className="w-4 h-4 text-accent" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">Kayıt {loginItems.findIndex(entry => entry.id === item.itemId) + 1}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="w-16 h-1.5 bg-abyss rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${item.strength}%`,
                        backgroundColor: strengthColors[item.strengthLabel],
                      }}
                    />
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {item.issues.slice(0, 2).map((issue) => (
                      <span key={issue} className="text-[10px] text-warning bg-warning/10 px-1.5 py-0.5 rounded">
                        {issue}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tekrar Edenler */}
      {duplicates.length > 0 && (
        <div className="glass rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-warning/10 flex items-center justify-center">
              <Repeat2 className="w-5 h-5 text-warning" />
            </div>
            <div>
              <h3 className="font-semibold">Tekrar Eden Şifreler ({duplicates.length} grup)</h3>
              <p className="text-sm text-text-secondary">Aynı şifreyi birden fazla yerde kullanmak risklidir</p>
            </div>
          </div>

          <div className="space-y-3">
            {duplicates.map((group, i) => (
              <div key={i} className="bg-surface rounded-xl p-4">
                <p className="text-xs text-text-muted mb-2">{group.items.length} hesapta aynı şifre kullanılıyor</p>
                <div className="space-y-1.5">
                  {group.items.map((item) => (
                    <div key={item.id} className="flex items-center gap-2 text-sm">
                      <ChevronRight className="w-3 h-3 text-warning shrink-0" />
                      <span className="text-text-primary">Kayıt {loginItems.findIndex(entry => entry.id === item.id) + 1}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tüm şifreler güçlü ise */}
      {weakPasswords.length === 0 && duplicates.length === 0 && (
        <div className="glass rounded-2xl p-8 text-center">
          <ShieldCheck className="w-12 h-12 text-accent mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">Harika! Tüm şifreleriniz güçlü</h3>
          <p className="text-text-secondary text-sm">Tekrar eden veya zayıf şifre bulunamadı</p>
        </div>
      )}
    </div>
  );
}
