"use client";

import { AlertTriangle } from "lucide-react";

type PlaintextExportFormat = "CSV" | "JSON";

interface PlaintextExportConfirmModalProps {
  format: PlaintextExportFormat;
  itemCount: number;
  description: string;
  onConfirm: () => void;
  onClose: () => void;
}

export default function PlaintextExportConfirmModal({
  format,
  itemCount,
  description,
  onConfirm,
  onClose,
}: PlaintextExportConfirmModalProps) {
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-midnight/80 px-4 backdrop-blur-xl"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="plaintext-export-title"
        className="w-full max-w-lg rounded-2xl border border-danger/30 bg-abyss p-6 shadow-2xl shadow-black/40"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-danger/10 text-danger">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <div>
            <h2 id="plaintext-export-title" className="text-lg font-semibold text-text-primary">
              Düz metin dışa aktarma
            </h2>
            <p className="mt-1 text-sm text-text-secondary">
              {itemCount} öğe şifrelenmemiş {format} dosyasına yazılacak.
            </p>
          </div>
        </div>

        <div className="space-y-3 rounded-xl border border-danger/20 bg-danger/5 p-4 text-sm text-text-secondary">
          <p>{description}</p>
          <p>
            Bu dosya VaultMaster koruması dışında kalır; cihazınızdaki veya bulut senkronizasyonundaki herkes tarafından okunabilir.
          </p>
          <p>Dosyayı yalnızca güvenli bir yerde saklayın ve işiniz bitince güvenli şekilde silin.</p>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:text-text-primary"
          >
            Vazgeç
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-xl bg-danger px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-danger/90"
          >
            Düz metin {format} indir
          </button>
        </div>
      </div>
    </div>
  );
}
