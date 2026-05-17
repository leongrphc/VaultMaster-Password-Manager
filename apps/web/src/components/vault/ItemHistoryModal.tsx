"use client";

import { useEffect, useState } from "react";
import { Clock3, Loader2, RotateCcw, X } from "lucide-react";
import { importMasterKey, decryptJSON } from "@vaultmaster/crypto";
import type { VaultItemData, VaultItemVersionResponse } from "@vaultmaster/shared";
import { useStore } from "@/lib/store";
import { api } from "@/lib/api";
import { useShallow } from "zustand/shallow";

interface HistoryEntry {
  id: string;
  reason: string;
  createdAt: string;
  data: VaultItemData | null;
}

interface ItemHistoryModalProps {
  itemId: string;
  title: string;
  onClose: () => void;
  onRestored?: () => Promise<void> | void;
}

export default function ItemHistoryModal({
  itemId,
  title,
  onClose,
  onRestored,
}: ItemHistoryModalProps) {
  const { masterKeyBase64, runWithValidAccessToken } = useStore(
    useShallow((state) => ({
      masterKeyBase64: state.masterKeyBase64,
      runWithValidAccessToken: state.runWithValidAccessToken,
    }))
  );
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadHistory = async () => {
      if (!masterKeyBase64) {
        setLoading(false);
        return;
      }

      try {
        const masterKey = await importMasterKey(masterKeyBase64);
        const response = (await runWithValidAccessToken((accessToken) =>
          api.vault.getHistory(itemId, accessToken) as Promise<{ data: VaultItemVersionResponse[] }>
        )) as { data: VaultItemVersionResponse[] };

        const decryptedEntries = await Promise.all(
          response.data.map(async (entry) => {
            try {
              const data = await decryptJSON<VaultItemData>(
                entry.encryptedData,
                entry.iv,
                masterKey
              );
              return {
                id: entry.id,
                reason: entry.reason,
                createdAt: entry.createdAt,
                data,
              };
            } catch {
              return {
                id: entry.id,
                reason: entry.reason,
                createdAt: entry.createdAt,
                data: null,
              };
            }
          })
        );

        if (!cancelled) {
          setEntries(decryptedEntries);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(
            nextError instanceof Error ? nextError.message : "Geçmiş sürümler yüklenemedi"
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, [itemId, masterKeyBase64, runWithValidAccessToken]);

  const handleRestore = async (versionId: string) => {
    setRestoringId(versionId);
    try {
      await runWithValidAccessToken((accessToken) =>
        api.vault.restoreVersion(itemId, versionId, accessToken)
      );
      await onRestored?.();
      onClose();
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Geçmiş sürüm geri yüklenemedi"
      );
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-midnight/80 backdrop-blur-sm" onClick={onClose} />

      <div className="relative glass rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-abyss/95 px-5 py-4">
          <div>
            <h3 className="text-lg font-bold">Sürüm Geçmişi</h3>
            <p className="text-sm text-text-secondary mt-1">{title}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Sürüm geçmişi modalını kapat"
            className="rounded-xl p-2 text-text-muted transition-colors hover:bg-surface hover:text-text-primary"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-text-secondary">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Sürüm geçmişi yükleniyor...
            </div>
          ) : error ? (
            <div className="rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
              {error}
            </div>
          ) : entries.length === 0 ? (
            <div className="rounded-xl bg-surface px-4 py-6 text-center text-sm text-text-secondary">
              Bu öğe için henüz kayıtlı bir sürüm yok.
            </div>
          ) : (
            <div className="space-y-3">
              {entries.map((entry) => (
                <div key={entry.id} className="rounded-2xl border border-border bg-surface/60 p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm text-text-secondary">
                      <Clock3 className="h-4 w-4 text-accent" />
                      {new Intl.DateTimeFormat("tr-TR", {
                        dateStyle: "short",
                        timeStyle: "short",
                      }).format(new Date(entry.createdAt))}
                      <span className="rounded-lg bg-abyss px-2 py-0.5 text-xs uppercase text-text-muted">
                        {entry.reason}
                      </span>
                    </div>
                    <button
                      onClick={() => handleRestore(entry.id)}
                      disabled={restoringId === entry.id}
                      className="inline-flex items-center gap-2 rounded-xl bg-accent/10 px-3 py-2 text-sm text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
                    >
                      {restoringId === entry.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RotateCcw className="h-4 w-4" />
                      )}
                      Bu Sürüme Dön
                    </button>
                  </div>

                  {entry.data ? (
                    <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl bg-abyss p-4 text-xs text-text-primary">
                      {JSON.stringify(entry.data, null, 2)}
                    </pre>
                  ) : (
                    <div className="rounded-xl bg-abyss px-4 py-3 text-sm text-warning">
                      Bu sürüm çözülemedi. Eski ana şifre ile oluşturulmuş olabilir.
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
