"use client";

import type { FolderResponse } from "@vaultmaster/shared";

interface BulkMoveModalProps {
  folders: FolderResponse[];
  selectedCount: number;
  onMove: (folderId: string | null) => void;
  onClose: () => void;
}

export default function BulkMoveModal({ folders, selectedCount, onMove, onClose }: BulkMoveModalProps) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-midnight/70 px-4 backdrop-blur-xl" onMouseDown={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-abyss p-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <h2 className="mb-1 text-lg font-semibold text-text-primary">Klasöre taşı</h2>
        <p className="mb-4 text-sm text-text-secondary">{selectedCount} öğe için hedef klasör seçin.</p>
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
      </div>
    </div>
  );
}
