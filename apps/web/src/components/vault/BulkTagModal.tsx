"use client";

import { useCallback, useState } from "react";
import { Modal } from "@/components/ui/Modal";

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
  const isDirty = value.trim().length > 0;

  const shouldBlockClose = useCallback(() => {
    return isDirty && !window.confirm("Kaydedilmemiş etiketler silinsin mi?");
  }, [isDirty]);

  const handleClose = useCallback(() => {
    if (!shouldBlockClose()) {
      onClose();
    }
  }, [onClose, shouldBlockClose]);

  return (
    <Modal
      title="Toplu etiket ekle"
      titleId="bulk-tag-title"
      onClose={onClose}
      isCloseBlocked={shouldBlockClose}
      panelClassName="max-w-md p-5"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (tags.length) onApply(tags);
        }}
      >
        <p className="mb-4 mt-1 text-sm text-text-secondary">{selectedCount} öğeye virgülle ayrılmış etiketler eklenecek.</p>
        <input
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="work, finance, critical"
          className="mb-4 w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm text-text-primary placeholder:text-text-muted focus:border-accent/50 focus:outline-none"
        />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={handleClose} className="rounded-xl border border-border px-4 py-2 text-sm text-text-secondary hover:text-text-primary">
            İptal
          </button>
          <button type="submit" className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-midnight hover:bg-accent-dim">
            Etiketleri ekle
          </button>
        </div>
      </form>
    </Modal>
  );
}
