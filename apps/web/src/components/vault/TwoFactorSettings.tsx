"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { Shield, Check, Loader2, RefreshCcw, Copy, Download, AlertTriangle } from "lucide-react";
import { api, getErrorMessage } from "@/lib/api";
import { copyWithAutoClear } from "@/lib/clipboard";
import { notify } from "@/lib/notify";
import { useStore } from "@/lib/store";
import { useShallow } from "zustand/shallow";

interface TwoFactorStatusResponse {
  data: {
    enabled: boolean;
    recoveryCodesRemaining: number;
  };
}

interface TwoFactorSetupResponse {
  data: {
    qrCode: string;
    secret: string;
  };
}

interface RecoveryCodesResponse {
  data: {
    recoveryCodes: string[];
  };
}

export default function TwoFactorSettings() {
  const { tokens, runWithValidAccessToken } = useStore(
    useShallow((state) => ({
      tokens: state.tokens,
      runWithValidAccessToken: state.runWithValidAccessToken,
    }))
  );
  const [isEnabled, setIsEnabled] = useState<boolean | null>(null);
  const [recoveryCodesRemaining, setRecoveryCodesRemaining] = useState(0);
  const [loading, setLoading] = useState(true);

  const [showSetup, setShowSetup] = useState(false);
  const [setupData, setSetupData] = useState<{ qrCode: string; secret: string } | null>(null);
  const [showRecoveryCodes, setShowRecoveryCodes] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [recoveryCodesSaved, setRecoveryCodesSaved] = useState(false);
  const [code, setCode] = useState("");
  const [recoveryCodeInput, setRecoveryCodeInput] = useState("");
  const [setupError, setSetupError] = useState("");
  const [setupLoading, setSetupLoading] = useState(false);
  const [disableError, setDisableError] = useState("");
  const [disableLoading, setDisableLoading] = useState(false);
  const [regenerateLoading, setRegenerateLoading] = useState(false);

  const loadStatus = useCallback(async () => {
    if (!tokens) {
      return;
    }

    try {
      const response = (await runWithValidAccessToken((accessToken) =>
        api.auth.twoFactorStatus(accessToken)
      )) as TwoFactorStatusResponse;

      setIsEnabled(response.data.enabled);
      setRecoveryCodesRemaining(response.data.recoveryCodesRemaining);
    } catch (error) {
      console.error("2FA Durum hatası:", error);
    } finally {
      setLoading(false);
    }
  }, [runWithValidAccessToken, tokens]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const handleStartSetup = async () => {
    try {
      const res = (await runWithValidAccessToken((accessToken) =>
        api.auth.twoFactorSetup(accessToken)
      )) as TwoFactorSetupResponse;
      setSetupData(res.data);
      setShowSetup(true);
      setCode("");
      setSetupError("");
    } catch (error) {
      notify.error(getErrorMessage(error, "Kurulum başlatılamadı"));
    }
  };

  const handleVerifySetup = async () => {
    if (code.length !== 6) {
      return;
    }

    setSetupLoading(true);
    setSetupError("");
    try {
      const response = (await runWithValidAccessToken((accessToken) =>
        api.auth.twoFactorVerify({ code }, accessToken)
      )) as RecoveryCodesResponse;
      setRecoveryCodes(response.data.recoveryCodes);
      setRecoveryCodesSaved(false);
      setShowRecoveryCodes(true);
      setShowSetup(false);
      setCode("");
      await loadStatus();
    } catch (error) {
      setSetupError(getErrorMessage(error, "Doğrulama başarısız"));
    } finally {
      setSetupLoading(false);
    }
  };

  const handleDisable = async () => {
    if (code.length !== 6 && !recoveryCodeInput.trim()) {
      return;
    }

    setDisableLoading(true);
    setDisableError("");
    try {
      await runWithValidAccessToken((accessToken) =>
        api.auth.twoFactorDisable(
          {
            code: code || undefined,
            recoveryCode: recoveryCodeInput.trim() || undefined,
          },
          accessToken
        )
      );

      setCode("");
      setRecoveryCodeInput("");
      await loadStatus();
    } catch (error) {
      setDisableError(getErrorMessage(error, "Devre dışı bırakılamadı"));
    } finally {
      setDisableLoading(false);
    }
  };

  const handleRegenerateCodes = async () => {
    if (code.length !== 6 && !recoveryCodeInput.trim()) {
      return;
    }

    setRegenerateLoading(true);
    setDisableError("");
    try {
      const response = (await runWithValidAccessToken((accessToken) =>
        api.auth.regenerateRecoveryCodes(
          {
            code: code || undefined,
            recoveryCode: recoveryCodeInput.trim() || undefined,
          },
          accessToken
        )
      )) as RecoveryCodesResponse;

      setRecoveryCodes(response.data.recoveryCodes);
      setRecoveryCodesSaved(false);
      setShowRecoveryCodes(true);
      setCode("");
      setRecoveryCodeInput("");
      await loadStatus();
    } catch (error) {
      setDisableError(getErrorMessage(error, "Recovery code yenilenemedi"));
    } finally {
      setRegenerateLoading(false);
    }
  };

  const copyRecoveryCodes = async () => {
    if (recoveryCodes.length === 0) {
      return;
    }

    await copyWithAutoClear(recoveryCodes.join("\n"));
    notify.copied("Recovery code'lar");
  };

  const downloadRecoveryCodes = () => {
    if (recoveryCodes.length === 0) {
      return;
    }

    const generatedAt = new Date();
    const content = [
      "VaultMaster Recovery Codes",
      `Olusturulma zamani: ${generatedAt.toISOString()}`,
      "",
      "Bu kodlari guvenli bir yerde saklayin. Her kod yalnizca bir kez kullanilabilir.",
      "Bu pencere kapatilir, sayfa yenilenir veya uygulama yeniden yuklenirse bu kodlar tekrar gosterilemez.",
      "",
      ...recoveryCodes,
      "",
    ].join("\n");

    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `vaultmaster-recovery-codes-${generatedAt.toISOString().split("T")[0]}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
    notify.success("Recovery code'lar indirildi");
  };

  const closeRecoveryCodesModal = () => {
    if (recoveryCodes.length > 0 && !recoveryCodesSaved) {
      notify.warning("Devam etmeden önce recovery code'ları kaydettiğinizi onaylayın.");
      return;
    }

    setShowRecoveryCodes(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-6 h-6 text-accent animate-spin" />
      </div>
    );
  }

  return (
    <>
      <div className="glass rounded-2xl p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                isEnabled
                  ? "bg-accent/10 text-accent"
                  : "bg-surface border border-border text-text-muted"
              }`}
            >
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold flex items-center gap-2">
                İki Faktörlü Doğrulama (2FA)
                {isEnabled && (
                  <span className="text-[10px] bg-accent/20 text-accent px-2 py-0.5 rounded-md font-bold uppercase">
                    Aktif
                  </span>
                )}
              </h3>
              <p className="text-sm text-text-secondary mt-1">
                Authenticator uygulaması ve recovery code desteği ile giriş güvenliğini artırın.
              </p>
              {isEnabled && (
                <p className="text-xs text-text-muted mt-2">
                  Kalan recovery code: {recoveryCodesRemaining}
                </p>
              )}
            </div>
          </div>

          {!isEnabled ? (
            <button
              onClick={handleStartSetup}
              className="bg-accent hover:bg-accent-dim text-midnight font-medium px-4 py-2 rounded-xl transition-colors text-sm shrink-0"
            >
              Kurulumu Başlat
            </button>
          ) : (
            <button
              onClick={() => setShowRecoveryCodes(true)}
              className="border border-border text-text-secondary hover:text-text-primary hover:bg-surface font-medium px-4 py-2 rounded-xl transition-colors text-sm shrink-0"
            >
              Recovery Codes
            </button>
          )}
        </div>

        {isEnabled && (
          <div className="mt-4 rounded-xl bg-surface p-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                type="text"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                className="w-full bg-abyss border border-border rounded-xl py-3 px-4 text-sm text-center tracking-[0.3em]"
                placeholder="2FA KODU"
              />
              <input
                type="text"
                value={recoveryCodeInput}
                onChange={(event) =>
                  setRecoveryCodeInput(event.target.value.toUpperCase())
                }
                className="w-full bg-abyss border border-border rounded-xl py-3 px-4 text-sm font-[family-name:var(--font-mono)]"
                placeholder="Recovery code"
              />
            </div>

            {disableError && (
              <p className="text-sm text-danger">{disableError}</p>
            )}

            <div className="flex flex-wrap gap-3">
              <button
                onClick={handleRegenerateCodes}
                disabled={regenerateLoading}
                className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm text-text-secondary hover:text-text-primary hover:bg-abyss transition-colors disabled:opacity-50"
              >
                {regenerateLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCcw className="w-4 h-4" />
                )}
                Recovery Codes Yenile
              </button>
              <button
                onClick={handleDisable}
                disabled={disableLoading}
                className="inline-flex items-center gap-2 rounded-xl bg-danger/10 px-4 py-2.5 text-sm font-medium text-danger hover:bg-danger/20 transition-colors disabled:opacity-50"
              >
                {disableLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                2FA Devre Dışı
              </button>
            </div>
          </div>
        )}
      </div>

      {showSetup && setupData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-midnight/80 backdrop-blur-sm" onClick={() => setShowSetup(false)} />

          <div className="relative glass rounded-2xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold mb-4">2FA Kurulumu</h3>
            <p className="text-sm text-text-secondary mb-6">
              Authenticator uygulamasında bu QR kodu okutun ve doğrulama kodunu girin.
            </p>

            <div className="bg-white p-4 rounded-xl flex justify-center mb-6">
              <Image src={setupData.qrCode} alt="2FA QR Code" width={192} height={192} />
            </div>

            <div className="text-center mb-6">
              <p className="text-xs text-text-muted mb-1">
                QR kodu okutamıyorsanız bu gizli anahtarı kullanın:
              </p>
              <code className="text-primary font-mono text-sm bg-surface px-3 py-1.5 rounded-lg border border-border">
                {setupData.secret}
              </code>
            </div>

            <div className="space-y-4">
              <input
                type="text"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                className="w-full bg-abyss border border-border rounded-xl py-3 px-4 text-center text-xl tracking-widest"
                placeholder="000000"
              />

              {setupError && <p className="text-sm text-danger text-center">{setupError}</p>}

              <button
                onClick={handleVerifySetup}
                disabled={code.length !== 6 || setupLoading}
                className="w-full bg-accent hover:bg-accent-dim text-midnight font-semibold py-3 rounded-xl disabled:opacity-50 transition-all flex justify-center items-center gap-2"
              >
                {setupLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    <Check className="w-5 h-5" /> Aktifleştir
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {showRecoveryCodes && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-midnight/80 backdrop-blur-sm" onClick={closeRecoveryCodesModal} />

          <div className="relative glass rounded-2xl w-full max-w-lg p-6">
            <div className="flex flex-col gap-4 mb-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-lg font-bold">Recovery Codes</h3>
                <p className="text-sm text-text-secondary mt-1">
                  Bunları güvenli bir yere kaydedin. Her biri yalnızca bir kez kullanılabilir.
                </p>
              </div>
              {recoveryCodes.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void copyRecoveryCodes()}
                    className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-surface"
                  >
                    <Copy className="w-4 h-4" />
                    Kopyala
                  </button>
                  <button
                    type="button"
                    onClick={downloadRecoveryCodes}
                    className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-surface"
                  >
                    <Download className="w-4 h-4" />
                    İndir
                  </button>
                </div>
              )}
            </div>

            <div className="mb-4 rounded-xl border border-warning/20 bg-warning/5 px-4 py-3 text-sm text-warning">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {"Bu recovery code'lar yalnızca oluşturuldukları anda gösterilir. Bu pencere kapatılır, sayfa yenilenir veya uygulama yeniden yüklenirse mevcut kodlar tekrar görüntülenemez."}
                </span>
              </div>
            </div>

            {recoveryCodes.length > 0 ? (
              <>
                <div className="grid gap-2 sm:grid-cols-2">
                  {recoveryCodes.map((entry) => (
                    <div
                      key={entry}
                      className="rounded-xl border border-border bg-surface px-4 py-3 font-[family-name:var(--font-mono)] text-sm text-text-primary"
                    >
                      {entry}
                    </div>
                  ))}
                </div>

                <label className="mt-4 flex items-start gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm text-text-secondary">
                  <input
                    type="checkbox"
                    checked={recoveryCodesSaved}
                    onChange={(event) => setRecoveryCodesSaved(event.target.checked)}
                    className="mt-1 accent-accent"
                  />
                  <span>
                    {"Recovery code'ları güvenli bir yere kaydettiğimi ve bu kodların tekrar gösterilemeyeceğini anlıyorum."}
                  </span>
                </label>
              </>
            ) : (
              <div className="rounded-xl border border-border bg-surface px-4 py-5 text-sm text-text-secondary">
                {"Recovery code'lar güvenlik nedeniyle yalnızca oluşturuldukları anda gösterilir. Bu sayfa yenilendiyse veya pencere kapatıldıysa mevcut kodlar tekrar görüntülenemez. Yeni bir set oluşturmak için yukarıdaki yenileme akışını kullanın."}
              </div>
            )}

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={closeRecoveryCodesModal}
                disabled={recoveryCodes.length > 0 && !recoveryCodesSaved}
                className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-midnight transition-all hover:bg-accent-dim disabled:opacity-50"
              >
                Tamam
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
