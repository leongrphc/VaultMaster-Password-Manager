"use client";

import { useState } from "react";

interface BulkTagModalProps {
  selectedCount: number;
  onApply: (tags: string[]) => void;
  onClose: () => void;
}

export default function BulkTagModal({ selectedCount, onApply, onClose }: BulkTagModalProps) {
  const [value, setValue] = useState("");
  const tags = value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-midnight/70 px-4 backdrop-blur-xl" onMouseDown={onClose}>
      <form
        className="w-full max-w-md rounded-2xl border border-border bg-abyss p-5 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (tags.length) onApply(tags);
        }}
      >
        <h2 className="mb-1 text-lg font-semibold text-text-primary">Toplu etiket ekle</h2>
        <p className="mb-4 text-sm text-text-secondary">{selectedCount} öğeye virgülle ayrılmış etiketler eklenecek.</p>
        <input
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="work, finance, critical"
          className="mb-4 w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm text-text-primary placeholder:text-text-muted focus:border-accent/50 focus:outline-none"
        />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-border px-4 py-2 text-sm text-text-secondary hover:text-text-primary">
            İptal
          </button>
          <button type="submit" className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-midnight hover:bg-accent-dim">
            Etiketleri ekle
          </button>
        </div>
      </form>
    </div>
  );
}
