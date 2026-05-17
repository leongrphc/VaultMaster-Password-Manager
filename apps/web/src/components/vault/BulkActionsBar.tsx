"use client";

import { Download, FolderInput, Star, Tag, Trash2, X } from "lucide-react";

interface BulkActionsBarProps {
  selectedCount: number;
  onMove: () => void;
  onTag: () => void;
  onFavorite: () => void;
  onDelete: () => void;
  onExport: () => void;
  onClear: () => void;
}

export default function BulkActionsBar({
  selectedCount,
  onMove,
  onTag,
  onFavorite,
  onDelete,
  onExport,
  onClear,
}: BulkActionsBarProps) {
  if (selectedCount === 0) {
    return null;
  }

  return (
    <div className="fixed bottom-6 left-1/2 z-50 w-[min(920px,calc(100vw-32px))] -translate-x-1/2 rounded-2xl border border-accent/20 bg-abyss/95 p-3 shadow-2xl shadow-black/40 backdrop-blur-xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent">
            {selectedCount}
          </div>
          <div>
            <p className="text-sm font-semibold text-text-primary">{selectedCount} öğe seçildi</p>
            <p className="text-xs text-text-secondary">Toplu işlem modu aktif</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <BulkButton onClick={onMove} label="Taşı" icon={<FolderInput className="w-4 h-4" />} />
          <BulkButton onClick={onTag} label="Etiketle" icon={<Tag className="w-4 h-4" />} />
          <BulkButton onClick={onFavorite} label="Favori" icon={<Star className="w-4 h-4" />} />
          <BulkButton onClick={onExport} label="Düz Metin" icon={<Download className="w-4 h-4" />} />
          <BulkButton onClick={onDelete} label="Sil" icon={<Trash2 className="w-4 h-4" />} danger />
          <button
            type="button"
            onClick={onClear}
            className="rounded-xl border border-border bg-surface p-2.5 text-text-secondary transition-colors hover:text-text-primary"
            aria-label="Seçimi temizle"
            title="Seçimi temizle"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function BulkButton({
  icon,
  label,
  danger = false,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition-all ${
        danger
          ? "border-danger/30 bg-danger/10 text-danger hover:bg-danger/15"
          : "border-border bg-surface text-text-secondary hover:border-accent/25 hover:text-text-primary"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
