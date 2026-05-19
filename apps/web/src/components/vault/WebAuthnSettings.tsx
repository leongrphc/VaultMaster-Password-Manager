"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Loader2, Pencil, Trash2 } from "lucide-react";
import { startRegistration } from "@simplewebauthn/browser";
import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import type { WebAuthnCredentialResponse } from "@vaultmaster/shared";
import { api, getErrorMessage } from "@/lib/api";
import { notify } from "@/lib/notify";
import { useStore } from "@/lib/store";
import { useShallow } from "zustand/shallow";

interface CredentialsResponse {
  data: WebAuthnCredentialResponse[];
}

interface RegistrationOptionsResponse {
  data: {
    options: PublicKeyCredentialCreationOptionsJSON;
    challengeToken: string;
  };
}

export default function WebAuthnSettings() {
  const { tokens, runWithValidAccessToken } = useStore(
    useShallow((state) => ({
      tokens: state.tokens,
      runWithValidAccessToken: state.runWithValidAccessToken,
    }))
  );
  const [credentials, setCredentials] = useState<WebAuthnCredentialResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadCredentials = useCallback(async () => {
    if (!tokens) {
      return;
    }

    try {
      const response = (await runWithValidAccessToken((accessToken) =>
        api.auth.webAuthnCredentials(accessToken)
      )) as CredentialsResponse;
      setCredentials(response.data);
    } catch (error) {
      notify.error(getErrorMessage(error, "WebAuthn anahtarları yüklenemedi"));
    } finally {
      setLoading(false);
    }
  }, [runWithValidAccessToken, tokens]);

  useEffect(() => {
    void loadCredentials();
  }, [loadCredentials]);

  const handleRegister = async () => {
    setRegistering(true);
    try {
      const optionsResponse = (await runWithValidAccessToken((accessToken) =>
        api.auth.webAuthnRegistrationOptions(accessToken)
      )) as RegistrationOptionsResponse;

      const response = await startRegistration({
        optionsJSON: optionsResponse.data.options,
      });

      await runWithValidAccessToken((accessToken) =>
        api.auth.webAuthnRegistrationVerify(
          {
            response,
            challengeToken: optionsResponse.data.challengeToken,
            name: `Security key ${credentials.length + 1}`,
          },
          accessToken
        )
      );

      notify.success("WebAuthn anahtarı eklendi");
      await loadCredentials();
    } catch (error) {
      notify.error(getErrorMessage(error, "WebAuthn anahtarı eklenemedi"));
    } finally {
      setRegistering(false);
    }
  };

  const handleRename = async (id: string) => {
    if (!nameDraft.trim()) {
      notify.error("Anahtar adı boş olamaz");
      return;
    }

    setBusyId(id);
    try {
      await runWithValidAccessToken((accessToken) =>
        api.auth.webAuthnRename(id, { name: nameDraft.trim() }, accessToken)
      );
      setEditingId(null);
      setNameDraft("");
      notify.success("Anahtar adı güncellendi");
      await loadCredentials();
    } catch (error) {
      notify.error(getErrorMessage(error, "Anahtar adı güncellenemedi"));
    } finally {
      setBusyId(null);
    }
  };

  const handleRemove = async (id: string) => {
    const confirmed = window.confirm("Bu WebAuthn anahtarını kaldırmak istediğinize emin misiniz?");
    if (!confirmed) {
      return;
    }

    setBusyId(id);
    try {
      await runWithValidAccessToken((accessToken) =>
        api.auth.webAuthnRemove(id, accessToken)
      );
      notify.success("WebAuthn anahtarı kaldırıldı");
      await loadCredentials();
    } catch (error) {
      notify.error(getErrorMessage(error, "WebAuthn anahtarı kaldırılamadı"));
    } finally {
      setBusyId(null);
    }
  };

  const formatDateTime = (value: string) =>
    new Intl.DateTimeFormat("tr-TR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(value));

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-6 h-6 text-accent animate-spin" />
      </div>
    );
  }

  return (
    <div className="glass rounded-2xl p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent/10 text-accent flex items-center justify-center">
            <KeyRound className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-semibold">WebAuthn / FIDO2 MFA</h3>
            <p className="text-sm text-text-secondary mt-1">
              Security key, YubiKey veya platform authenticator ile phishing-resistant giriş koruması ekleyin.
            </p>
          </div>
        </div>

        <button
          onClick={handleRegister}
          disabled={registering}
          className="inline-flex items-center gap-2 bg-accent hover:bg-accent-dim text-midnight font-medium px-4 py-2 rounded-xl transition-colors text-sm shrink-0 disabled:opacity-50"
        >
          {registering ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Anahtar Ekle
        </button>
      </div>

      <div className="mt-4 space-y-3">
        {credentials.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface px-4 py-5 text-sm text-text-secondary">
            Kayıtlı WebAuthn anahtarı yok. Eklediğiniz anahtarlar giriş sırasında TOTP/recovery akışına alternatif MFA olarak kullanılabilir.
          </div>
        ) : (
          credentials.map((credential) => (
            <div key={credential.id} className="rounded-2xl border border-border bg-surface/60 p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  {editingId === credential.id ? (
                    <input
                      autoFocus
                      value={nameDraft}
                      onChange={(event) => setNameDraft(event.target.value)}
                      className="mb-2 min-w-[220px] rounded-lg border border-accent/30 bg-abyss px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent/60"
                    />
                  ) : (
                    <p className="text-sm font-medium text-text-primary">
                      {credential.name || "Security key"}
                    </p>
                  )}
                  <div className="mt-2 grid gap-2 text-xs text-text-secondary sm:grid-cols-2">
                    <div className="rounded-xl bg-abyss px-3 py-2">
                      Oluşturulma: {formatDateTime(credential.createdAt)}
                    </div>
                    <div className="rounded-xl bg-abyss px-3 py-2">
                      Son kullanım: {credential.lastUsedAt ? formatDateTime(credential.lastUsedAt) : "-"}
                    </div>
                    <div className="rounded-xl bg-abyss px-3 py-2">
                      Tip: {credential.deviceType || "Bilinmiyor"}
                    </div>
                    <div className="rounded-xl bg-abyss px-3 py-2">
                      Yedekli: {credential.backedUp ? "Evet" : "Hayır"}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 shrink-0">
                  {editingId === credential.id ? (
                    <>
                      <button
                        onClick={() => handleRename(credential.id)}
                        disabled={busyId === credential.id}
                        className="rounded-xl px-4 py-2 text-sm font-medium bg-accent/10 text-accent hover:bg-accent/20 disabled:opacity-40"
                      >
                        Kaydet
                      </button>
                      <button
                        onClick={() => {
                          setEditingId(null);
                          setNameDraft("");
                        }}
                        className="rounded-xl px-4 py-2 text-sm font-medium bg-surface text-text-secondary hover:text-text-primary"
                      >
                        Vazgeç
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => {
                        setEditingId(credential.id);
                        setNameDraft(credential.name || "Security key");
                      }}
                      className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium bg-surface text-text-secondary hover:text-text-primary"
                    >
                      <Pencil className="w-4 h-4" />
                      Adı Düzenle
                    </button>
                  )}

                  <button
                    onClick={() => handleRemove(credential.id)}
                    disabled={busyId === credential.id}
                    className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium bg-danger/10 text-danger hover:bg-danger/20 disabled:opacity-40"
                  >
                    <Trash2 className="w-4 h-4" />
                    Kaldır
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
