"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Shield, Eye, EyeOff, ArrowRight, Lock, Mail, AlertTriangle } from "lucide-react";
import {
  deriveMasterKey,
  exportMasterKeyBase64,
} from "@vaultmaster/crypto";
import { generateAuthHash } from "@vaultmaster/crypto";
import { useStore } from "@/lib/store";
import { api, getErrorMessage } from "@/lib/api";
import type { LoginResponse } from "@vaultmaster/shared";
import { useShallow } from "zustand/shallow";
import { notify } from "@/lib/notify";
import PasswordStrengthMeter from "@/components/ui/PasswordStrengthMeter";

export default function LoginPage() {
  const router = useRouter();
  const { isAuthenticated, setAuth, setMasterKey } = useStore(
    useShallow((state) => ({
      isAuthenticated: state.isAuthenticated,
      setAuth: state.setAuth,
      setMasterKey: state.setMasterKey,
    }))
  );
  const [hydrated, setHydrated] = useState(false);

  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [acknowledgedNoRecovery, setAcknowledgedNoRecovery] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [requires2FA, setRequires2FA] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");

  useEffect(() => {
    if (useStore.persist?.hasHydrated?.()) {
      setHydrated(true);
    }

    const unsubscribe =
      useStore.persist?.onFinishHydration?.(() => {
        setHydrated(true);
      }) ?? (() => undefined);

    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (hydrated && isAuthenticated) {
      router.replace("/vault");
    }
  }, [hydrated, isAuthenticated, router]);

  const handlePasswordKeyEvent = (event: React.KeyboardEvent<HTMLInputElement>) => {
    setCapsLockOn(event.getModifierState("CapsLock"));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (isRegister && !acknowledgedNoRecovery) {
      setError("Devam etmek için kurtarma olmadığını onaylamalısınız");
      return;
    }

    if (isRegister && password !== confirmPassword) {
      setError("Şifreler eşleşmiyor");
      return;
    }

    if (password.length < 8) {
      setError("Ana şifre en az 8 karakter olmalı");
      return;
    }

    setLoading(true);

    try {
      const masterKey = await deriveMasterKey(password, email);
      const authHash = await generateAuthHash(masterKey, password);
      const masterKeyB64 = await exportMasterKeyBase64(masterKey);

      let response: { success: boolean; data: LoginResponse };

      if (isRegister) {
        response = (await api.auth.register({
          email,
          authHash,
          kdfSalt: email.toLowerCase().trim(),
          kdfIterations: 600_000,
        })) as { success: boolean; data: LoginResponse };
      } else {
        response = (await api.auth.login({
          email,
          authHash,
          code: requires2FA && !useRecoveryCode ? twoFactorCode : undefined,
          recoveryCode: requires2FA && useRecoveryCode ? recoveryCode : undefined,
        })) as { success: boolean; data: LoginResponse };
        
        if (response.data.requires2FA) {
          setRequires2FA(true);
          return;
        }
      }

      if (response.data.tokens && response.data.user) {
        setAuth(
          response.data.tokens,
          response.data.user.email,
          response.data.user.id,
          response.data.deviceId ?? null
        );
        setMasterKey(masterKeyB64);
        window.location.assign("/vault");
      }
    } catch (err: unknown) {
      const message = getErrorMessage(err, "Giriş işlemi tamamlanamadı");
      setError(message);
      notify.error(message);
    } finally {
      setLoading(false);
    }
  };

  if (!hydrated) {
    return (
      <div className="min-h-screen bg-midnight flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-midnight">
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `
              linear-gradient(rgba(0,255,178,0.3) 1px, transparent 1px),
              linear-gradient(90deg, rgba(0,255,178,0.3) 1px, transparent 1px)
            `,
            backgroundSize: "60px 60px",
            animation: "gridPulse 4s ease-in-out infinite",
          }}
        />
        <div
          className="absolute top-1/4 -left-32 w-96 h-96 rounded-full opacity-8"
          style={{
            background: "radial-gradient(circle, rgba(0,255,178,0.08), transparent 70%)",
            animation: "float 6s ease-in-out infinite",
          }}
        />
        <div
          className="absolute bottom-1/4 -right-32 w-[500px] h-[500px] rounded-full"
          style={{
            background: "radial-gradient(circle, rgba(0,212,255,0.06), transparent 70%)",
            animation: "float 8s ease-in-out infinite reverse",
          }}
        />
      </div>

      {/* Left Side - Branding */}
      <div className="hidden lg:flex lg:w-1/2 relative z-10 flex-col justify-center items-center p-16">
        <div className="animate-fade-in max-w-lg">
          <div className="flex items-center gap-4 mb-8">
            <div className="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center glow-accent">
              <Shield className="w-8 h-8 text-accent" />
            </div>
            <div>
              <h1 className="text-4xl font-bold font-[family-name:var(--font-display)] tracking-tight">
                Vault<span className="text-gradient">Master</span>
              </h1>
              <p className="text-text-secondary text-sm tracking-widest uppercase">
                Zero-Knowledge Security
              </p>
            </div>
          </div>

          <p className="text-xl text-text-secondary leading-relaxed mb-12">
            Şifreleriniz yalnızca size ait. Uçtan uca şifreleme ile verileriniz
            sunucuya bile şifrelenmeden ulaşmaz.{" "}
            <span className="text-accent font-medium">Sıfır bilgi mimarisi.</span>
          </p>

          <div className="space-y-6">
            {[
              { title: "AES-256-GCM", desc: "Askeri seviye şifreleme" },
              { title: "PBKDF2 Key Derivation", desc: "600.000 iterasyon ile brute-force koruması" },
              { title: "Sıfır Bilgi", desc: "Sunucu şifrelenmemiş veriyi asla görmez" },
            ].map((item, i) => (
              <div
                key={item.title}
                className="flex items-start gap-4 animate-slide-up"
                style={{ animationDelay: `${i * 150}ms` }}
              >
                <div className="w-2 h-2 rounded-full bg-accent mt-2 shrink-0" />
                <div>
                  <p className="text-text-primary font-medium font-[family-name:var(--font-mono)] text-sm">
                    {item.title}
                  </p>
                  <p className="text-text-secondary text-sm">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right Side - Form */}
      <div className="flex-1 flex items-center justify-center p-8 relative z-10">
        <div className="w-full max-w-md animate-slide-up">
          {/* Mobile Logo */}
          <div className="lg:hidden flex items-center gap-3 mb-10 justify-center">
            <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center">
              <Shield className="w-6 h-6 text-accent" />
            </div>
            <h1 className="text-2xl font-bold font-[family-name:var(--font-display)]">
              Vault<span className="text-gradient">Master</span>
            </h1>
          </div>

          <div className="glass rounded-2xl p-8">
            <h2 className="text-2xl font-bold mb-2 font-[family-name:var(--font-display)]">
              {isRegister ? "Hesap Oluştur" : "Giriş Yap"}
            </h2>
            <p className="text-text-secondary mb-8 text-sm">
              {isRegister
                ? "Ana şifrenizi unutmayın — kurtarma yolu yoktur."
                : requires2FA 
                  ? "Devam etmek için iki faktörlü doğrulama kodunuzu girin."
                  : "Kasanıza güvenle erişin."}
            </p>

            <form onSubmit={handleSubmit} className="space-y-5">
              {!requires2FA ? (
                <>
              <div>
                <label className="block text-sm text-text-secondary mb-2" htmlFor="email">
                  E-posta
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                  <input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-abyss border border-border rounded-xl py-3 pl-10 pr-4 text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all"
                    placeholder="ornek@email.com"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm text-text-secondary mb-2" htmlFor="password">
                  Ana Şifre
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={handlePasswordKeyEvent}
                    onKeyUp={handlePasswordKeyEvent}
                    onBlur={() => setCapsLockOn(false)}
                    className="w-full bg-abyss border border-border rounded-xl py-3 pl-10 pr-12 text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all font-[family-name:var(--font-mono)]"
                    placeholder="••••••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors"
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
                {capsLockOn && (
                  <div className="mt-2 flex items-center gap-2 text-xs text-warning">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    <span>Caps Lock açık olabilir.</span>
                  </div>
                )}
                {isRegister && <PasswordStrengthMeter password={password} className="mt-3" />}
              </div>

              {isRegister && (
                <div>
                  <label
                    className="block text-sm text-text-secondary mb-2"
                    htmlFor="confirmPassword"
                  >
                    Ana Şifre (Tekrar)
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                    <input
                      id="confirmPassword"
                      type={showPassword ? "text" : "password"}
                      required
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      onKeyDown={handlePasswordKeyEvent}
                      onKeyUp={handlePasswordKeyEvent}
                      onBlur={() => setCapsLockOn(false)}
                      className="w-full bg-abyss border border-border rounded-xl py-3 pl-10 pr-4 text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all font-[family-name:var(--font-mono)]"
                      placeholder="••••••••••••"
                    />
                  </div>
                </div>
              )}

              {isRegister && (
                <label className="flex items-start gap-3 rounded-xl border border-warning/20 bg-warning/5 p-3 text-xs text-text-secondary">
                  <input
                    type="checkbox"
                    checked={acknowledgedNoRecovery}
                    onChange={(event) => setAcknowledgedNoRecovery(event.target.checked)}
                    className="mt-0.5 accent-accent"
                  />
                  <span>
                    Ana şifremi unutursam VaultMaster’ın kasamı kurtaramayacağını ve verilerime erişemeyeceğimi anlıyorum.
                  </span>
                </label>
              )}
              </>
              ) : (
                <div>
                  <label className="block text-sm text-text-secondary mb-2" htmlFor="twoFactorCode">
                    Doğrulama Kodu (2FA)
                  </label>
                  <div className="relative">
                    <Shield className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                    <input
                      id="twoFactorCode"
                      type="text"
                      required
                      maxLength={useRecoveryCode ? 32 : 6}
                      value={useRecoveryCode ? recoveryCode : twoFactorCode}
                      onChange={(e) =>
                        useRecoveryCode
                          ? setRecoveryCode(e.target.value.toUpperCase())
                          : setTwoFactorCode(e.target.value.replace(/\D/g, ""))
                      }
                      className={`w-full bg-abyss border border-border rounded-xl py-3 pl-10 pr-4 text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all font-[family-name:var(--font-mono)] ${useRecoveryCode ? "text-sm" : "text-center tracking-widest text-lg"}`}
                      placeholder={useRecoveryCode ? "ABCD-EF12-3456" : "000000"}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setUseRecoveryCode(!useRecoveryCode);
                      setTwoFactorCode("");
                      setRecoveryCode("");
                    }}
                    className="mt-2 text-sm text-text-secondary hover:text-accent transition-colors"
                  >
                    {useRecoveryCode ? "Authenticator koduna dön" : "Recovery code kullan"}
                  </button>
                </div>
              )}

              {error && (
                <div className="bg-danger/10 border border-danger/20 rounded-xl px-4 py-3 text-danger text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-accent hover:bg-accent-dim text-midnight font-semibold py-3 rounded-xl flex items-center justify-center gap-2 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-lg hover:shadow-accent/20"
              >
                {loading ? (
                  <div className="w-5 h-5 border-2 border-midnight/30 border-t-midnight rounded-full animate-spin" />
                ) : (
                  <>
                    {isRegister ? "Hesap Oluştur" : requires2FA ? "Doğrula" : "Kasayı Aç"}
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>

            <div className="mt-6 text-center">
              <button
                onClick={() => {
                  setError("");
                  if (requires2FA) {
                    setRequires2FA(false);
                    setTwoFactorCode("");
                    setRecoveryCode("");
                    setUseRecoveryCode(false);
                    return;
                  }
                  setAcknowledgedNoRecovery(false);
                  setCapsLockOn(false);
                  setIsRegister(!isRegister);
                }}
                className="text-text-secondary hover:text-accent text-sm transition-colors"
              >
                {requires2FA
                  ? "Geri dön"
                  : isRegister
                  ? "Zaten hesabınız var mı? Giriş yapın"
                  : "Hesabınız yok mu? Kayıt olun"}
              </button>
            </div>
          </div>

          {isRegister && (
            <div className="mt-4 glass rounded-xl p-4 text-xs text-text-muted flex items-start gap-2">
              <Shield className="w-4 h-4 text-accent shrink-0 mt-0.5" />
              <p>
                Ana şifreniz asla sunucuya gönderilmez. Tüm şifreleme işlemleri
                tarayıcınızda gerçekleşir. Şifrenizi kaybederseniz
                verilerinize erişemezsiniz.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
