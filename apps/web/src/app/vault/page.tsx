"use client";

import { useEffect, useMemo, useState } from "react";
import { Globe, Plus, Tag, X } from "lucide-react";
import { useStore, type DecryptedVaultItem } from "@/lib/store";
import AddItemModal from "@/components/vault/AddItemModal";
import EditItemModal from "@/components/vault/EditItemModal";
import ItemHistoryModal from "@/components/vault/ItemHistoryModal";
import VaultItemCard from "@/components/vault/VaultItemCard";
import ViewControls from "@/components/vault/ViewControls";
import SearchBar from "@/components/vault/SearchBar";
import BulkActionsBar from "@/components/vault/BulkActionsBar";
import BulkMoveModal from "@/components/vault/BulkMoveModal";
import BulkTagModal from "@/components/vault/BulkTagModal";
import PlaintextExportConfirmModal from "@/components/vault/PlaintextExportConfirmModal";
import VaultSkeleton from "@/components/vault/VaultSkeleton";
import { generateTotpCode } from "@/lib/totp";
import { searchVaultItems } from "@/lib/search";
import { useShallow } from "zustand/shallow";
import { getErrorMessage } from "@/lib/api";
import { copyWithAutoClear } from "@/lib/clipboard";
import { notify } from "@/lib/notify";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";

export default function VaultPage() {
  const {
    items,
    selectedFolderId,
    showFavoritesOnly,
    searchQuery,
    sortBy,
    viewMode,
    favoritesFirst,
    isSelectionMode,
    selectedItemIds,
    folders,
    setSearchQuery,
    setSortBy,
    setViewMode,
    setFavoritesFirst,
    setSelectionMode,
    toggleSelectedItem,
    setSelectedItems,
    clearSelection,
    isLoading,
    deleteVaultItem,
    updateVaultItemFull,
    toggleFavorite,
    loadVault,
  } = useStore(
    useShallow((state) => ({
      items: state.items,
      selectedFolderId: state.selectedFolderId,
      showFavoritesOnly: state.showFavoritesOnly,
      searchQuery: state.searchQuery,
      sortBy: state.sortBy,
      viewMode: state.viewMode,
      favoritesFirst: state.favoritesFirst,
      isSelectionMode: state.isSelectionMode,
      selectedItemIds: state.selectedItemIds,
      folders: state.folders,
      setSearchQuery: state.setSearchQuery,
      setSortBy: state.setSortBy,
      setViewMode: state.setViewMode,
      setFavoritesFirst: state.setFavoritesFirst,
      setSelectionMode: state.setSelectionMode,
      toggleSelectedItem: state.toggleSelectedItem,
      setSelectedItems: state.setSelectedItems,
      clearSelection: state.clearSelection,
      isLoading: state.isLoading,
      deleteVaultItem: state.deleteVaultItem,
      updateVaultItemFull: state.updateVaultItemFull,
      toggleFavorite: state.toggleFavorite,
      loadVault: state.loadVault,
    }))
  );

  const [showAddModal, setShowAddModal] = useState(false);
  const [editItem, setEditItem] = useState<DecryptedVaultItem | null>(null);
  const [selectedItem, setSelectedItem] = useState<DecryptedVaultItem | null>(null);
  const [revealedPasswords, setRevealedPasswords] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [historyItem, setHistoryItem] = useState<DecryptedVaultItem | null>(null);
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [bulkTagOpen, setBulkTagOpen] = useState(false);
  const [showPlaintextBulkExportConfirm, setShowPlaintextBulkExportConfirm] = useState(false);
  const [totpState, setTotpState] = useState<{
    itemId: string;
    code: string | null;
    expiresIn: number;
    error: string | null;
  } | null>(null);

  const allTags = useMemo(
    () => Array.from(new Set(items.flatMap((item) => item.data.tags || []))).sort(),
    [items]
  );

  useEffect(() => {
    let active = true;

    if (!selectedItem || selectedItem.data.type !== "login" || !selectedItem.data.totpSecret) {
      return;
    }

    const itemId = selectedItem.id;
    const secret = selectedItem.data.totpSecret;

    const updateCode = async () => {
      try {
        const next = await generateTotpCode(secret);
        if (!active) return;
        setTotpState({ itemId, code: next.code, expiresIn: next.expiresIn, error: null });
      } catch {
        if (!active) return;
        setTotpState({ itemId, code: null, expiresIn: 0, error: "TOTP secret okunamadi" });
      }
    };

    void updateCode();
    const interval = window.setInterval(() => void updateCode(), 1000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [selectedItem]);

  const filteredItems = useMemo(() => {
    const scopedItems = items.filter((item) => {
      if (selectedFolderId && item.folderId !== selectedFolderId) return false;
      if (showFavoritesOnly && !item.favorite) return false;
      if (activeTag && !(item.data.tags || []).includes(activeTag)) return false;
      return true;
    });

    return searchVaultItems(scopedItems, searchQuery);
  }, [activeTag, items, searchQuery, selectedFolderId, showFavoritesOnly]);

  const sortedItems = useMemo(
    () => sortVaultItems(filteredItems, sortBy, favoritesFirst),
    [favoritesFirst, filteredItems, sortBy]
  );

  useKeyboardShortcuts([
    {
      key: "n",
      ctrl: true,
      meta: true,
      action: () => setShowAddModal(true),
    },
    {
      key: "f",
      ctrl: true,
      meta: true,
      action: () => document.getElementById("vault-search-input")?.focus(),
    },
  ]);

  const selectedTotpState =
    selectedItem?.data.type === "login" &&
    selectedItem.data.totpSecret &&
    totpState?.itemId === selectedItem.id
      ? totpState
      : null;

  const togglePasswordVisibility = (id: string) => {
    setRevealedPasswords((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const copyToClipboard = async (text: string, id: string) => {
    await copyWithAutoClear(text);
    setCopiedId(id);
    notify.copied();
    setTimeout(() => setCopiedId(null), 2000);
  };

  const selectedItems = useMemo(
    () => items.filter((item) => selectedItemIds.includes(item.id)),
    [items, selectedItemIds]
  );

  const handleDelete = async (item: DecryptedVaultItem) => {
    if (!confirm("Bu öğeyi silmek istediğinize emin misiniz?")) {
      return;
    }

    try {
      await deleteVaultItem(item.id);
      notify.deleted();
    } catch (error) {
      notify.error(getErrorMessage(error, "Öğe silinemedi"));
    }
  };

  const runBulkOperation = async (
    operation: (item: DecryptedVaultItem) => Promise<void>,
    successMessage: string
  ) => {
    const results = await Promise.allSettled(selectedItems.map(operation));
    const failed = results.filter((result) => result.status === "rejected").length;
    if (failed) {
      notify.error(`${selectedItems.length - failed}/${selectedItems.length} işlem tamamlandı, ${failed} hata var.`);
      return;
    }
    notify.success(successMessage);
    clearSelection();
  };

  const handleBulkDelete = async () => {
    if (!confirm(`${selectedItems.length} öğeyi çöp kutusuna taşımak istediğinize emin misiniz?`)) return;
    await runBulkOperation((item) => deleteVaultItem(item.id), "Seçili öğeler silindi.");
  };

  const handleBulkMove = async (folderId: string | null) => {
    setBulkMoveOpen(false);
    await runBulkOperation(
      (item) => updateVaultItemFull(item.id, item.data, folderId),
      "Seçili öğeler taşındı."
    );
  };

  const handleBulkTag = async (tags: string[]) => {
    setBulkTagOpen(false);
    await runBulkOperation(
      (item) => {
        const nextTags = Array.from(new Set([...(item.data.tags || []), ...tags]));
        return updateVaultItemFull(item.id, { ...item.data, tags: nextTags }, item.folderId);
      },
      "Etiketler seçili öğelere eklendi."
    );
  };

  const handleBulkFavorite = async () => {
    await runBulkOperation(
      async (item) => {
        if (!item.favorite) await toggleFavorite(item.id);
      },
      "Seçili öğeler favorilere eklendi."
    );
  };

  const handleBulkExportRequest = () => {
    if (selectedItems.length === 0) return;
    setShowPlaintextBulkExportConfirm(true);
  };

  const performBulkExport = () => {
    const blob = new Blob([JSON.stringify(selectedItems.map((item) => item.data), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `vaultmaster-selected-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setShowPlaintextBulkExportConfirm(false);
    notify.success("Seçili öğeler düz metin JSON olarak dışa aktarıldı.");
  };

  if (isLoading) {
    return <VaultSkeleton />;
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-col gap-4 mb-6 lg:flex-row lg:items-center lg:justify-between">
        <SearchBar value={searchQuery} onChange={setSearchQuery} />

        <div className="flex flex-wrap items-center gap-3">
          <ViewControls
            sortBy={sortBy}
            viewMode={viewMode}
            favoritesFirst={favoritesFirst}
            onSortChange={setSortBy}
            onViewModeChange={setViewMode}
            onFavoritesFirstChange={setFavoritesFirst}
          />
          <button
            type="button"
            onClick={() => setSelectionMode(!isSelectionMode)}
            className={`rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all ${
              isSelectionMode
                ? "border-accent/40 bg-accent/10 text-accent"
                : "border-border bg-surface text-text-secondary hover:text-text-primary"
            }`}
          >
            Seç
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="bg-accent hover:bg-accent-dim text-midnight font-semibold px-5 py-2.5 rounded-xl flex items-center gap-2 transition-all hover:shadow-lg hover:shadow-accent/20 text-sm shrink-0"
          >
            <Plus className="w-4 h-4" />
            Yeni Öğe
          </button>
        </div>
      </div>

      {isSelectionMode && sortedItems.length > 0 && (
        <div className="mb-4 flex items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3">
          <input
            type="checkbox"
            checked={sortedItems.length > 0 && sortedItems.every((item) => selectedItemIds.includes(item.id))}
            onChange={(event) => setSelectedItems(event.target.checked ? sortedItems.map((item) => item.id) : [])}
            className="h-4 w-4 accent-accent"
            aria-label="Filtrelenen öğelerin tamamını seç"
          />
          <span className="text-sm text-text-secondary">
            Filtrelenen {sortedItems.length} öğeyi seç
          </span>
        </div>
      )}

      {allTags.length > 0 && (
        <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-1">
          <Tag className="w-3.5 h-3.5 text-text-muted shrink-0" />
          {allTags.map((tag) => (
            <button
              key={tag}
              onClick={() => setActiveTag(activeTag === tag ? null : tag)}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all whitespace-nowrap border ${
                activeTag === tag
                  ? "bg-accent/15 text-accent border-accent/40"
                  : "bg-surface text-text-secondary border-border hover:border-accent/20"
              }`}
            >
              {tag}
              {activeTag === tag && <X className="w-3 h-3" />}
            </button>
          ))}
        </div>
      )}

      {sortedItems.length === 0 ? (
        <div className="glass rounded-2xl p-16 text-center">
          <div className="w-16 h-16 rounded-2xl bg-surface flex items-center justify-center mx-auto mb-4">
            <Globe className="w-8 h-8 text-text-muted" />
          </div>
          <h3 className="text-lg font-semibold mb-2">Kasa boş</h3>
          <p className="text-text-secondary text-sm mb-6">
            İlk giriş bilginizi ekleyerek başlayın
          </p>
          <button
            onClick={() => setShowAddModal(true)}
            className="bg-accent hover:bg-accent-dim text-midnight font-semibold px-6 py-2.5 rounded-xl inline-flex items-center gap-2 transition-all text-sm"
          >
            <Plus className="w-4 h-4" />
            İlk Öğeyi Ekle
          </button>
        </div>
      ) : (
        <div className={viewMode === "grid" ? "grid gap-3 sm:grid-cols-2 xl:grid-cols-3" : "space-y-2"}>
          {sortedItems.map((item, index) => (
            <VaultItemCard
              key={item.id}
              item={item}
              viewMode={viewMode}
              isSelected={selectedItem?.id === item.id}
              isPasswordRevealed={revealedPasswords.has(item.id)}
              copiedId={copiedId}
              totpState={selectedItem?.id === item.id ? selectedTotpState : null}
              index={index}
              onSelect={() => setSelectedItem(selectedItem?.id === item.id ? null : item)}
              onCopy={(text, id) => void copyToClipboard(text, id)}
              onTogglePassword={() => togglePasswordVisibility(item.id)}
              onEdit={() => setEditItem(item)}
              onHistory={() => setHistoryItem(item)}
              onToggleFavorite={() => void toggleFavorite(item.id)}
              selectionMode={isSelectionMode}
              isChecked={selectedItemIds.includes(item.id)}
              onCheckedChange={() => toggleSelectedItem(item.id)}
              onDelete={() => void handleDelete(item)}
            />
          ))}
        </div>
      )}

      <BulkActionsBar
        selectedCount={selectedItems.length}
        onMove={() => setBulkMoveOpen(true)}
        onTag={() => setBulkTagOpen(true)}
        onFavorite={() => void handleBulkFavorite()}
        onDelete={() => void handleBulkDelete()}
        onExport={handleBulkExportRequest}
        onClear={clearSelection}
      />

      {bulkMoveOpen && (
        <BulkMoveModal
          folders={folders}
          selectedCount={selectedItems.length}
          onMove={(folderId) => void handleBulkMove(folderId)}
          onClose={() => setBulkMoveOpen(false)}
        />
      )}
      {bulkTagOpen && (
        <BulkTagModal
          selectedCount={selectedItems.length}
          onApply={(tags) => void handleBulkTag(tags)}
          onClose={() => setBulkTagOpen(false)}
        />
      )}
      {showPlaintextBulkExportConfirm && (
        <PlaintextExportConfirmModal
          format="JSON"
          itemCount={selectedItems.length}
          description="Seçili öğelerin tüm kasa verileri şifrelenmeden JSON dosyasına yazılacak. Parolalar, güvenli notlar, kart bilgileri ve özel alanlar okunabilir kalabilir."
          onConfirm={performBulkExport}
          onClose={() => setShowPlaintextBulkExportConfirm(false)}
        />
      )}
      {showAddModal && <AddItemModal onClose={() => setShowAddModal(false)} />}
      {editItem && <EditItemModal item={editItem} onClose={() => setEditItem(null)} />}
      {historyItem && (
        <ItemHistoryModal
          itemId={historyItem.id}
          title={historyItem.data.title}
          onClose={() => setHistoryItem(null)}
          onRestored={async () => {
            await loadVault();
          }}
        />
      )}
    </div>
  );
}

function sortVaultItems(items: DecryptedVaultItem[], sortBy: string, favoritesFirst: boolean) {
  return [...items].sort((a, b) => {
    if (favoritesFirst && a.favorite !== b.favorite) {
      return a.favorite ? -1 : 1;
    }

    if (sortBy === "name-asc") return a.data.title.localeCompare(b.data.title, "tr");
    if (sortBy === "name-desc") return b.data.title.localeCompare(a.data.title, "tr");
    if (sortBy === "updated-asc") return Date.parse(a.updatedAt) - Date.parse(b.updatedAt);
    if (sortBy === "created-desc") return Date.parse(b.createdAt) - Date.parse(a.createdAt);
    if (sortBy === "created-asc") return Date.parse(a.createdAt) - Date.parse(b.createdAt);
    if (sortBy === "type") return a.data.type.localeCompare(b.data.type, "tr") || a.data.title.localeCompare(b.data.title, "tr");
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  });
}
