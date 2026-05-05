"use client";

import { Grid2X2, List, Rows3, Star } from "lucide-react";
import type { VaultSortBy, VaultViewMode } from "@/lib/store";

interface ViewControlsProps {
  sortBy: VaultSortBy;
  viewMode: VaultViewMode;
  favoritesFirst: boolean;
  onSortChange: (sortBy: VaultSortBy) => void;
  onViewModeChange: (viewMode: VaultViewMode) => void;
  onFavoritesFirstChange: (enabled: boolean) => void;
}

const sortOptions: { value: VaultSortBy; label: string }[] = [
  { value: "updated-desc", label: "Son güncellenen" },
  { value: "updated-asc", label: "Eski güncellenen" },
  { value: "created-desc", label: "Yeni eklenen" },
  { value: "created-asc", label: "Eski eklenen" },
  { value: "name-asc", label: "A-Z" },
  { value: "name-desc", label: "Z-A" },
  { value: "type", label: "Türe göre" },
];

const viewOptions: { value: VaultViewMode; label: string; icon: React.ReactNode }[] = [
  { value: "comfortable", label: "Rahat liste", icon: <List className="w-4 h-4" /> },
  { value: "compact", label: "Kompakt", icon: <Rows3 className="w-4 h-4" /> },
  { value: "grid", label: "Grid", icon: <Grid2X2 className="w-4 h-4" /> },
];

export default function ViewControls({
  sortBy,
  viewMode,
  favoritesFirst,
  onSortChange,
  onViewModeChange,
  onFavoritesFirstChange,
}: ViewControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={sortBy}
        onChange={(event) => onSortChange(event.target.value as VaultSortBy)}
        className="bg-surface border border-border rounded-xl py-2.5 px-3 text-sm text-text-primary focus:outline-none focus:border-accent/50 transition-colors"
        aria-label="Kasa sıralaması"
      >
        {sortOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <button
        type="button"
        onClick={() => onFavoritesFirstChange(!favoritesFirst)}
        className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-all ${
          favoritesFirst
            ? "border-warning/40 bg-warning/10 text-warning"
            : "border-border bg-surface text-text-secondary hover:border-accent/25 hover:text-text-primary"
        }`}
        aria-pressed={favoritesFirst}
      >
        <Star className="w-4 h-4" fill={favoritesFirst ? "currentColor" : "none"} />
        Favoriler üstte
      </button>

      <div className="inline-flex rounded-xl border border-border bg-surface p-1" role="group" aria-label="Görünüm modu">
        {viewOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onViewModeChange(option.value)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm transition-all ${
              viewMode === option.value
                ? "bg-accent text-midnight shadow-lg shadow-accent/10"
                : "text-text-secondary hover:text-text-primary"
            }`}
            aria-label={option.label}
            aria-pressed={viewMode === option.value}
            title={option.label}
          >
            {option.icon}
          </button>
        ))}
      </div>
    </div>
  );
}
