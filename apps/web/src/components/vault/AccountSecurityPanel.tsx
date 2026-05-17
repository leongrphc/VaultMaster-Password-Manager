"use client";

import { useState } from "react";
import { AlertTriangle, KeyRound, Loader2, Shield } from "lucide-react";
import {
  deriveMasterKey,
  encryptJSON,
  exportMasterKeyBase64,
  generateAuthHash,
} from "@vaultmaster/crypto";
import { useStore } from "@/lib/store";
import { api } from "@/lib/api";
import { useShallow } from "zustand/shallow";
import PasswordStrengthMeter from "@/components/ui/PasswordStrengthMeter";

export default function AccountSecurityPanel() {
  const {
    items,
    userEmail,
    masterKeyBase64,
    setMasterKey,
    syncOfflineSnapshot,
    runWithValidAccessToken,
    logout,
  } = useStore(
    useShallow((state) => ({
      items: state.items,
      userEmail: state.userEmail,
      masterKeyBase64: state.masterKeyBase64,
      setMasterKey: state.setMasterKey,
      syncOfflineSnapshot: state.syncOfflineSnapshot,
      runWithValidAccessToken: state.runWithValidAccessToken,
      logout: state.logout,
    }))
  );
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [changeLoading, setChangeLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [changeError, setChangeError] = useState("");
  const [changeSuccess, setChangeSuccess] = useState("");
  const [deleteError, setDeleteError] = useState("");

  const handlePasswordKeyEvent = (event: React.KeyboardEvent<HTMLInputElement>) => {
    setCapsLockOn(event.getModifierState("CapsLock"));
  };

  const handleChangePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!userEmail || !masterKeyBase64) {
      return;
    }

    setChangeError("");
    setChangeSuccess("");

    if (newPassword.length < 8) {
      setChangeError("Yeni ana şifre en az 8 karakter olmalı");
      return;
    }

    if (newPassword !== confirmPassword) {
      setChangeError("Yeni şifreler eşleşmiyor");
      return;
    }

    setChangeLoading(true);
    try {
      const currentMasterKey = await deriveMasterKey(currentPassword, userEmail);
      const currentMasterKeyBase64 = await exportMasterKeyBase64(currentMasterKey);

      if (currentMasterKeyBase64 !== masterKeyBase64) {
        setChangeError("Mevcut ana şifre doğrulanamadı");
        setChangeLoading(false);
        return;
      }

      const newMasterKey = await deriveMasterKey(newPassword, userEmail);
      const newMasterKeyBase64 = await exportMasterKeyBase64(newMasterKey);
      const currentAuthHash = await generateAuthHash(currentMasterKey, currentPassword);
      const newAuthHash = await generateAuthHash(newMasterKey, newPassword);

      const reencryptedItems = await Promise.all(
        items.map(async (item) => {
          const encrypted = await encryptJSON(item.data, newMasterKey);
          return {
            id: item.id,
            encryptedData: encrypted.ciphertext,
            iv: encrypted.iv,
          };
        })
      );

      await runWithValidAccessToken((accessToken) =>
        api.auth.changePassword(
          {
            currentAuthHash,
            newAuthHash,
            kdfIterations: 600_000,
            items: reencryptedItems,
          },
          accessToken
        )
      );

      setMasterKey(newMasterKeyBase64);
      await syncOfflineSnapshot();
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setChangeSuccess("Ana şifre güncellendi");
    } catch (error) {
      setChangeError(
        error instanceof Error ? error.message : "Ana şifre güncellenemedi"
      );
    } finally {
      setChangeLoading(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!userEmail) {
      return;
    }

    const confirmed = window.confirm(
      "Hesabınız ve tüm kasanız kalıcı olarak silinecek. Devam etmek istiyor musunuz?"
    );
    if (!confirmed) {
      return;
    }

    setDeleteError("");
    setDeleteLoading(true);
    try {
      const currentMasterKey = await deriveMasterKey(currentPassword, userEmail);
      const authHash = await generateAuthHash(currentMasterKey, currentPassword);

      await runWithValidAccessToken((accessToken) =>
        api.auth.deleteAccount(
          {
            authHash,
            code: twoFactorCode || undefined,
            recoveryCode: recoveryCode || undefined,
          },
          accessToken
        )
      );

      logout();
      window.location.assign("/");
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : "Hesap silinemedi"
      );
    } finally {
      setDeleteLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="glass rounded-2xl p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
            <KeyRound className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h3 className="font-semibold">Ana Şifreyi Değiştir</h3>
            <p className="text-sm text-text-secondary">
              Tüm kasa içeriği yeni anahtar ile yeniden şifrelenir
            </p>
          </div>
        </div>

        <form onSubmit={handleChangePassword} className="space-y-4">
          <input
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            onKeyDown={handlePasswordKeyEvent}
            onKeyUp={handlePasswordKeyEvent}
            onBlur={() => setCapsLockOn(false)}
            className="w-full bg-abyss border border-border rounded-xl py-3 px-4 text-sm"
            placeholder="Mevcut ana şifre"
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              onKeyDown={handlePasswordKeyEvent}
              onKeyUp={handlePasswordKeyEvent}
              onBlur={() => setCapsLockOn(false)}
              className="w-full bg-abyss border border-border rounded-xl py-3 px-4 text-sm"
              placeholder="Yeni ana şifre"
            />
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              onKeyDown={handlePasswordKeyEvent}
              onKeyUp={handlePasswordKeyEvent}
              onBlur={() => setCapsLockOn(false)}
              className="w-full bg-abyss border border-border rounded-xl py-3 px-4 text-sm"
              placeholder="Yeni ana şifre (tekrar)"
            />
          </div>

          <PasswordStrengthMeter password={newPassword} />

          {capsLockOn && (
            <div className="flex items-center gap-2 rounded-xl border border-warning/20 bg-warning/5 px-3 py-2 text-xs text-warning">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>Caps Lock açık olabilir.</span>
            </div>
          )}

          {changeError && (
            <div className="rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
              {changeError}
            </div>
          )}
          {changeSuccess && (
            <div className="rounded-xl border border-accent/20 bg-accent/5 px-4 py-3 text-sm text-accent">
              {changeSuccess}
            </div>
          )}

          <button
            type="submit"
            disabled={changeLoading}
            className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-midnight transition-all disabled:opacity-50"
          >
            {changeLoading && <Loader2 className="w-4 h-4 animate-spin" />}
            Ana Şifreyi Güncelle
          </button>
        </form>
      </div>

      <div className="glass rounded-2xl border border-danger/20 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-danger/10 flex items-center justify-center">
            <Shield className="w-5 h-5 text-danger" />
          </div>
          <div>
            <h3 className="font-semibold text-danger">Hesabı Sil</h3>
            <p className="text-sm text-text-secondary">
              Tüm veriler, oturumlar ve audit kayıtları kullanıcı düzeyinde kaldırılır
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <input
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            onKeyDown={handlePasswordKeyEvent}
            onKeyUp={handlePasswordKeyEvent}
            onBlur={() => setCapsLockOn(false)}
            className="w-full bg-abyss border border-border rounded-xl py-3 px-4 text-sm"
            placeholder="Ana şifre"
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              type="text"
              maxLength={6}
              value={twoFactorCode}
              onChange={(event) =>
                setTwoFactorCode(event.target.value.replace(/\D/g, ""))
              }
              className="w-full bg-abyss border border-border rounded-xl py-3 px-4 text-sm"
              placeholder="2FA kodu"
            />
            <input
              type="text"
              value={recoveryCode}
              onChange={(event) => setRecoveryCode(event.target.value.toUpperCase())}
              className="w-full bg-abyss border border-border rounded-xl py-3 px-4 text-sm font-[family-name:var(--font-mono)]"
              placeholder="Recovery code"
            />
          </div>

          <div className="rounded-xl border border-warning/20 bg-warning/5 p-3 text-xs text-warning">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Bu işlem geri alınamaz.</span>
            </div>
          </div>

          {deleteError && (
            <div className="rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
              {deleteError}
            </div>
          )}

          <button
            type="button"
            onClick={handleDeleteAccount}
            disabled={deleteLoading}
            className="inline-flex items-center gap-2 rounded-xl bg-danger/10 px-4 py-2.5 text-sm font-semibold text-danger transition-all hover:bg-danger/20 disabled:opacity-50"
          >
            {deleteLoading && <Loader2 className="w-4 h-4 animate-spin" />}
            Hesabı Kalıcı Olarak Sil
          </button>
        </div>
      </div>
    </div>
  );
}
