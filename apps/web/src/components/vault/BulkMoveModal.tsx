"use client";

import type { FolderResponse } from "@vaultmaster/shared";
import { Modal } from "@/components/ui/Modal";

interface BulkMoveModalProps {
  folders: FolderResponse[];
  selectedCount: number;
  onMove: (folderId: string | null) => void;
  onClose: () => void;
}

export default function BulkMoveModal({ folders, selectedCount, onMove, onClose }: BulkMoveModalProps) {
  return (
    <Modal title="Klasöre taşı" titleId="bulk-move-title" onClose={onClose} panelClassName="max-w-md p-5">
      <p className="mb-4 mt-1 text-sm text-text-secondary">{selectedCount} öğe için hedef klasör seçin.</p>
      <div className="grid gap-2">
        <button type="button" onClick={() => onMove(null)} className="rounded-xl border border-border bg-surface px-4 py-3 text-left text-sm text-text-primary hover:border-accent/30">
          Klasörsüz
        </button>
        {folders.map((folder) => (
          <button key={folder.id} type="button" onClick={() => onMove(folder.id)} className="rounded-xl border border-border bg-surface px-4 py-3 text-left text-sm text-text-primary hover:border-accent/30">
            {folder.name}
          </button>
        ))}
      </div>
    </Modal>
  );
}
