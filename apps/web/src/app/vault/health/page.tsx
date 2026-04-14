"use client";

import { useMemo, useState } from "react";
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
import { calculateStrength, getStrengthLabel } from "@vaultmaster/crypto";

interface PasswordIssue {
  itemId: string;
  title: string;
  username: string;
  url?: string;
  password: string;
  issues: string[];
  strength: number;
  strengthLabel: string;
}

interface DuplicateGroup {
  password: string;
  items: { id: string; title: string; username: string }[];
}

export default function HealthReportPage() {
  const items = useStore((state) => state.items);
  const [checkedBreaches, setCheckedBreaches] = useState<Record<string, number | null>>({});
  const [checkingBreaches, setCheckingBreaches] = useState(false);

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
            title: item.data.title,
            username: item.data.username,
            url: item.data.url,
            password: pw,
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
    const pwMap = new Map<string, { id: string; title: string; username: string }[]>();

    loginItems.forEach((item) => {
      const pw = item.data.password;
      if (!pwMap.has(pw)) pwMap.set(pw, []);
      pwMap.get(pw)!.push({
        id: item.id,
        title: item.data.title,
        username: item.data.username,
      });
    });

    return Array.from(pwMap.entries())
      .filter(([, items]) => items.length > 1)
      .map(([password, items]) => ({ password, items }));
  }, [loginItems]);

  // HIBP kontrolü (k-anonymity)
  const checkBreaches = async () => {
    setCheckingBreaches(true);
    const results: Record<string, number | null> = {};

    for (const item of loginItems) {
      const pw = item.data.password;
      try {
        const encoder = new TextEncoder();
        const data = encoder.encode(pw);
        const hashBuffer = await crypto.subtle.digest("SHA-1", data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();

        const prefix = hashHex.slice(0, 5);
        const suffix = hashHex.slice(5);

        const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`);
        const text = await res.text();

        const lines = text.split("\n");
        const match = lines.find((line) => line.startsWith(suffix));

        if (match) {
          const count = parseInt(match.split(":")[1].trim(), 10);
          results[item.id] = count;
        } else {
          results[item.id] = 0;
        }
      } catch {
        results[item.id] = null;
      }
    }

    setCheckedBreaches(results);
    setCheckingBreaches(false);
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
            {overallScore >= 80 ? "Kasanız güvenli" : overallScore >= 50 ? "İyileştirme gerekli" : "Acil aksiyon gerekiyor"}
          </h3>
          <p className="text-text-secondary text-sm mb-4">
            {totalLogins} giriş bilgisi analiz edildi
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
                {breachedCount > 0 ? breachedCount : Object.keys(checkedBreaches).length > 0 ? "0" : "?"}
              </p>
              <p className="text-xs text-text-muted mt-1">Sızdırılmış</p>
            </div>
          </div>
        </div>
      </div>

      {/* HIBP Kontrol */}
      <div className="glass rounded-2xl p-6 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-danger/10 flex items-center justify-center">
              <ShieldAlert className="w-5 h-5 text-danger" />
            </div>
            <div>
              <h3 className="font-semibold">Sızıntı Kontrolü</h3>
              <p className="text-sm text-text-secondary">
                Have I Been Pwned veritabanında şifrelerinizi kontrol edin (k-anonymity ile güvenli)
              </p>
            </div>
          </div>
          <button
            onClick={checkBreaches}
            disabled={checkingBreaches}
            className="bg-danger/10 hover:bg-danger/20 text-danger font-medium px-5 py-2.5 rounded-xl flex items-center gap-2 transition-all text-sm disabled:opacity-50 shrink-0"
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
        </div>

        {breachedItems.length > 0 && (
          <div className="mt-4 space-y-2">
            {breachedItems.map(([itemId, count]) => {
              const item = loginItems.find((i) => i.id === itemId);
              if (!item) return null;
              return (
                <div key={itemId} className="flex items-center gap-3 bg-danger/5 border border-danger/20 rounded-xl p-3">
                  <AlertTriangle className="w-4 h-4 text-danger shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.data.title}</p>
                    <p className="text-xs text-text-muted">{item.data.username}</p>
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
                  <p className="text-sm font-medium truncate">{item.title}</p>
                  <p className="text-xs text-text-muted truncate">{item.username}</p>
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
                      <span className="text-text-primary">{item.title}</span>
                      <span className="text-text-muted">({item.username})</span>
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
