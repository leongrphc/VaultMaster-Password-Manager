"use client";

import { useCallback, useEffect, useState } from "react";
import { importMasterKey, decryptJSON } from "@vaultmaster/crypto";
import type { VaultItemData, VaultItemResponse } from "@vaultmaster/shared";
import { Loader2, RotateCcw, Trash2, History } from "lucide-react";
import { useStore } from "@/lib/store";
import { api, getErrorMessage } from "@/lib/api";
import ItemHistoryModal from "@/components/vault/ItemHistoryModal";
import { useShallow } from "zustand/shallow";
import { notify } from "@/lib/notify";

interface DeletedVaultItem {
  id: string;
  data: VaultItemData;
  deletedAt: string | null;
}

export default function TrashPage() {
  const { masterKeyBase64, runWithValidAccessToken, loadVault } = useStore(
    useShallow((state) => ({
      masterKeyBase64: state.masterKeyBase64,
      runWithValidAccessToken: state.runWithValidAccessToken,
      loadVault: state.loadVault,
    }))
  );
  const [items, setItems] = useState<DeletedVaultItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [historyItem, setHistoryItem] = useState<DeletedVaultItem | null>(null);

  const loadTrash = useCallback(async () => {
    if (!masterKeyBase64) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const masterKey = await importMasterKey(masterKeyBase64);
      const response = (await runWithValidAccessToken((accessToken) =>
        api.vault.getTrash(accessToken) as Promise<{ data: VaultItemResponse[] }>
      )) as { data: VaultItemResponse[] };

      const decrypted = await Promise.all(
        response.data.map(async (item) => {
          const data = await decryptJSON<VaultItemData>(
            item.encryptedData,
            item.iv,
            masterKey
          );

          return {
            id: item.id,
            data,
            deletedAt: item.deletedAt ?? null,
          };
        })
      );

      setItems(decrypted);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Çöp kutusu yüklenemedi");
    } finally {
      setLoading(false);
    }
  }, [masterKeyBase64, runWithValidAccessToken]);

  useEffect(() => {
    void loadTrash();
  }, [loadTrash]);

  const handleRestore = async (id: string) => {
    try {
      await runWithValidAccessToken((accessToken) => api.vault.restore(id, accessToken));
      await Promise.all([loadTrash(), loadVault()]);
      notify.restored();
    } catch (error) {
      notify.error(getErrorMessage(error, "Öğe geri yüklenemedi"));
    }
  };

  const handlePurge = async (id: string) => {
    const confirmed = window.confirm(
      "Bu öğe kalıcı olarak silinecek. Devam etmek istiyor musunuz?"
    );
    if (!confirmed) {
      return;
    }

    try {
      await runWithValidAccessToken((accessToken) => api.vault.purge(id, accessToken));
      await loadTrash();
      notify.purged();
    } catch (error) {
      notify.error(getErrorMessage(error, "Öğe silinemedi"));
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-bold font-[family-name:var(--font-display)]">
          Çöp Kutusu
        </h2>
        <p className="mt-2 text-sm text-text-secondary">
          Silinen öğeler burada tutulur. Geri yükleyebilir veya kalıcı silebilirsiniz.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-text-secondary">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Çöp kutusu yükleniyor...
        </div>
      ) : error ? (
        <div className="rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      ) : items.length === 0 ? (
        <div className="glass rounded-2xl p-16 text-center text-sm text-text-secondary">
          Çöp kutusu boş.
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.id} className="glass rounded-2xl p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium text-text-primary">{item.data.title}</p>
                  <p className="mt-1 text-sm text-text-secondary">
                    {new Intl.DateTimeFormat("tr-TR", {
                      dateStyle: "short",
                      timeStyle: "short",
                    }).format(new Date(item.deletedAt ?? Date.now()))}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setHistoryItem(item)}
                    className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm text-text-secondary hover:bg-surface hover:text-text-primary"
                  >
                    <History className="h-4 w-4" />
                    Geçmiş
                  </button>
                  <button
                    onClick={() => void handleRestore(item.id)}
                    className="inline-flex items-center gap-2 rounded-xl bg-accent/10 px-3 py-2 text-sm text-accent hover:bg-accent/20"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Geri Yükle
                  </button>
                  <button
                    onClick={() => void handlePurge(item.id)}
                    className="inline-flex items-center gap-2 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger hover:bg-danger/20"
                  >
                    <Trash2 className="h-4 w-4" />
                    Kalıcı Sil
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {historyItem && (
        <ItemHistoryModal
          itemId={historyItem.id}
          title={historyItem.data.title}
          onClose={() => setHistoryItem(null)}
          onRestored={async () => {
            await Promise.all([loadTrash(), loadVault()]);
          }}
        />
      )}
    </div>
  );
}
