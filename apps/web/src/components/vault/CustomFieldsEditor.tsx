"use client";

import { Plus, Trash2, Eye, EyeOff } from "lucide-react";
import type { VaultItemCustomField } from "@vaultmaster/shared";

interface CustomFieldsEditorProps {
  fields: VaultItemCustomField[];
  onChange: (fields: VaultItemCustomField[]) => void;
  idPrefix?: string;
}

function createField(): VaultItemCustomField {
  return {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `field-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    label: "",
    value: "",
    concealed: false,
  };
}

export default function CustomFieldsEditor({
  fields,
  onChange,
  idPrefix = "custom-fields",
}: CustomFieldsEditorProps) {
  const updateField = (
    id: string,
    key: keyof VaultItemCustomField,
    value: string | boolean
  ) => {
    onChange(
      fields.map((field) =>
        field.id === id ? { ...field, [key]: value } : field
      )
    );
  };

  const removeField = (id: string) => {
    onChange(fields.filter((field) => field.id !== id));
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <label className="block text-sm text-text-secondary">Özel Alanlar</label>
        <button
          type="button"
          onClick={() => onChange([...fields, createField()])}
          className="inline-flex items-center gap-1.5 text-xs text-accent hover:text-accent-dim transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Alan ekle
        </button>
      </div>

      {fields.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface px-4 py-3 text-xs text-text-muted">
          API key, tenant ID, müşteri numarası gibi ekstra gizli alanlar ekleyebilirsiniz.
        </div>
      ) : (
        <div className="space-y-3">
          {fields.map((field) => {
            const labelInputId = `${idPrefix}-${field.id}-label`;
            const valueInputId = `${idPrefix}-${field.id}-value`;

            return (
            <div key={field.id} className="rounded-xl border border-border bg-surface p-3">
              <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr_auto]">
                <label htmlFor={labelInputId} className="sr-only">Alan adı</label>
                <input
                  id={labelInputId}
                  value={field.label}
                  onChange={(e) => updateField(field.id, "label", e.target.value)}
                  className="w-full bg-abyss border border-border rounded-xl py-2.5 px-4 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 transition-colors"
                  placeholder="Alan adı"
                />
                <label htmlFor={valueInputId} className="sr-only">Alan değeri</label>
                <input
                  id={valueInputId}
                  type={field.concealed ? "password" : "text"}
                  value={field.value}
                  onChange={(e) => updateField(field.id, "value", e.target.value)}
                  className="w-full bg-abyss border border-border rounded-xl py-2.5 px-4 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 transition-colors font-[family-name:var(--font-mono)]"
                  placeholder="Alan değeri"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      updateField(field.id, "concealed", !field.concealed)
                    }
                    className="p-2.5 rounded-xl border border-border text-text-muted hover:text-text-primary transition-colors"
                    title={field.concealed ? "Değeri göster" : "Değeri gizle"}
                    aria-label={field.concealed ? "Özel alan değerini göster" : "Özel alan değerini gizle"}
                  >
                    {field.concealed ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeField(field.id)}
                    className="p-2.5 rounded-xl border border-danger/20 text-danger hover:bg-danger/10 transition-colors"
                    title="Alanı sil"
                    aria-label="Özel alanı sil"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
