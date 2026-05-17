"use client";

import { useState } from "react";
import { Lock, ArrowRight, Shield } from "lucide-react";
import { useStore } from "@/lib/store";
import { useShallow } from "zustand/shallow";

export default function LockScreen() {
  const { userEmail, unlockVault, logout } = useStore(
    useShallow((state) => ({
      userEmail: state.userEmail,
      unlockVault: state.unlockVault,
      logout: state.logout,
    }))
  );
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || !userEmail) return;

    setLoading(true);
    setError("");

    const success = await unlockVault(password, userEmail);
    if (!success) {
      setError("Yanlış ana şifre");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-midnight flex items-center justify-center p-8">
      <div className="absolute inset-0">
        <div
          className="absolute inset-0 opacity-[0.02]"
          style={{
            backgroundImage: `
              linear-gradient(rgba(0,255,178,0.3) 1px, transparent 1px),
              linear-gradient(90deg, rgba(0,255,178,0.3) 1px, transparent 1px)
            `,
            backgroundSize: "60px 60px",
          }}
        />
      </div>

      <div className="relative z-10 w-full max-w-sm animate-slide-up">
        <div className="text-center mb-8">
          <div className="w-20 h-20 rounded-2xl bg-accent/10 flex items-center justify-center mx-auto mb-4 animate-pulse-glow">
            <Lock className="w-10 h-10 text-accent" />
          </div>
          <h1 className="text-2xl font-bold font-[family-name:var(--font-display)]">
            Kasa Kilitli
          </h1>
          <p className="text-text-secondary text-sm mt-2">
            İnaktiflik nedeniyle kasa otomatik olarak kilitlendi
          </p>
        </div>

        <div className="glass rounded-2xl p-6">
          <form onSubmit={handleUnlock} className="space-y-4">
            <div>
              <label
                htmlFor="lock-screen-password"
                className="block text-xs text-text-muted mb-1.5 uppercase tracking-wider"
              >
                Ana Şifre
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                <input
                  id="lock-screen-password"
                  autoFocus
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-abyss border border-border rounded-xl py-3 pl-10 pr-4 text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all font-[family-name:var(--font-mono)]"
                  placeholder="••••••••••••"
                />
              </div>
            </div>

            {error && (
              <div className="bg-danger/10 border border-danger/20 rounded-xl px-4 py-2.5 text-danger text-sm text-center">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-accent hover:bg-accent-dim text-midnight font-semibold py-3 rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-50"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-midnight/30 border-t-midnight rounded-full animate-spin" />
              ) : (
                <>
                  Kilidi Aç
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          <div className="mt-4 pt-4 border-t border-border text-center">
            <button
              onClick={() => {
                logout();
                window.location.assign("/");
              }}
              className="text-sm text-text-muted hover:text-danger transition-colors"
            >
              Farklı hesap ile giriş yap
            </button>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-center gap-2 text-xs text-text-muted">
          <Shield className="w-3 h-3" />
          <span>{userEmail}</span>
        </div>
      </div>
    </div>
  );
}
