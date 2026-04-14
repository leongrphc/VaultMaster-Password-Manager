"use client";

import { Menu, Shield } from "lucide-react";
import { useStore } from "@/lib/store";
import { useShallow } from "zustand/shallow";

interface VaultHeaderProps {
  onMenuToggle: () => void;
}

export default function VaultHeader({ onMenuToggle }: VaultHeaderProps) {
  const { userEmail, items, isUsingOfflineData, lastSyncedAt } = useStore(
    useShallow((state) => ({
      userEmail: state.userEmail,
      items: state.items,
      isUsingOfflineData: state.isUsingOfflineData,
      lastSyncedAt: state.lastSyncedAt,
    }))
  );

  const syncLabel = lastSyncedAt
    ? new Intl.DateTimeFormat("tr-TR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(lastSyncedAt))
    : null;

  return (
    <header className="h-16 border-b border-border flex items-center justify-between px-6 bg-abyss/50 backdrop-blur-sm sticky top-0 z-20">
      <div className="flex items-center gap-4">
        <button
          onClick={onMenuToggle}
          className="p-2 rounded-lg hover:bg-surface text-text-muted hover:text-text-primary transition-colors lg:hidden"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-accent" />
          <span className="text-sm text-text-secondary">
            <span className="text-text-primary font-medium">{items.length}</span> öğe korunuyor
          </span>
        </div>

        {isUsingOfflineData && (
          <div className="hidden sm:flex items-center gap-2 rounded-full border border-warning/20 bg-warning/5 px-3 py-1 text-xs text-warning">
            <span>Offline mod</span>
            {syncLabel && <span className="text-warning/70">Son senkron: {syncLabel}</span>}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center text-accent font-semibold text-sm uppercase">
          {userEmail?.[0]}
        </div>
      </div>
    </header>
  );
}
