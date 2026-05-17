"use client";

import { AlertTriangle } from "lucide-react";
import { ConfirmModal } from "@/components/ui/Modal";

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
    <ConfirmModal
      title="Düz metin dışa aktarma"
      titleId="plaintext-export-title"
      description={
        <div className="space-y-3 rounded-xl border border-danger/20 bg-danger/5 p-4 text-sm text-text-secondary">
          <p>{description}</p>
          <p>
            Bu dosya VaultMaster koruması dışında kalır; cihazınızdaki veya bulut senkronizasyonundaki herkes tarafından okunabilir.
          </p>
          <p>Dosyayı yalnızca güvenli bir yerde saklayın ve işiniz bitince güvenli şekilde silin.</p>
        </div>
      }
      confirmLabel={`Düz metin ${format} indir`}
      onConfirm={onConfirm}
      onClose={onClose}
      tone="danger"
      icon={<AlertTriangle className="h-6 w-6" />}
    >
      <p className="mt-1 text-sm text-text-secondary">
        {itemCount} öğe şifrelenmemiş {format} dosyasına yazılacak.
      </p>
    </ConfirmModal>
  );
}
