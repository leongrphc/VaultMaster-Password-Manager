"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  Search,
  Globe,
  User,
  CreditCard,
  FileText,
  Star,
  Trash2,
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  Pencil,
  Tag,
  X,
  KeyRound,
  History,
} from "lucide-react";
import { useStore, type DecryptedVaultItem } from "@/lib/store";
import AddItemModal from "@/components/vault/AddItemModal";
import EditItemModal from "@/components/vault/EditItemModal";
import { generateTotpCode } from "@/lib/totp";
import ItemHistoryModal from "@/components/vault/ItemHistoryModal";
import { useShallow } from "zustand/shallow";
import { getErrorMessage } from "@/lib/api";
import { copyWithAutoClear } from "@/lib/clipboard";
import { notify } from "@/lib/notify";

export default function VaultPage() {
  const {
    items,
    selectedFolderId,
    showFavoritesOnly,
    searchQuery,
    setSearchQuery,
    isLoading,
    deleteVaultItem,
    toggleFavorite,
    loadVault,
  } = useStore(
    useShallow((state) => ({
      items: state.items,
      selectedFolderId: state.selectedFolderId,
      showFavoritesOnly: state.showFavoritesOnly,
      searchQuery: state.searchQuery,
      setSearchQuery: state.setSearchQuery,
      isLoading: state.isLoading,
      deleteVaultItem: state.deleteVaultItem,
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
        if (!active) {
          return;
        }

        setTotpState({
          itemId,
          code: next.code,
          expiresIn: next.expiresIn,
          error: null,
        });
      } catch {
        if (!active) {
          return;
        }

        setTotpState({
          itemId,
          code: null,
          expiresIn: 0,
          error: "TOTP secret okunamadi",
        });
      }
    };

    void updateCode();
    const interval = window.setInterval(() => {
      void updateCode();
    }, 1000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [selectedItem]);

  const selectedTotpState =
    selectedItem &&
    selectedItem.data.type === "login" &&
    selectedItem.data.totpSecret &&
    totpState?.itemId === selectedItem.id
      ? totpState
      : null;

  const filteredItems = useMemo(
    () =>
      items.filter((item) => {
        if (selectedFolderId && item.folderId !== selectedFolderId) return false;
        if (showFavoritesOnly && !item.favorite) return false;
        if (activeTag && !(item.data.tags || []).includes(activeTag)) return false;
        if (!searchQuery) return true;

        const q = searchQuery.toLowerCase();
        const d = item.data;

        if (d.type === "login") {
          return (
            d.title.toLowerCase().includes(q) ||
            d.username.toLowerCase().includes(q) ||
            d.url?.toLowerCase().includes(q) ||
            d.totpSecret?.toLowerCase().includes(q) ||
            (d.customFields || []).some(
              (field) =>
                field.label.toLowerCase().includes(q) ||
                field.value.toLowerCase().includes(q)
            ) ||
            (d.tags || []).some((t) => t.includes(q))
          );
        }
        if (d.type === "secure_note") {
          return (
            d.title.toLowerCase().includes(q) ||
            d.content.toLowerCase().includes(q) ||
            (d.customFields || []).some(
              (field) =>
                field.label.toLowerCase().includes(q) ||
                field.value.toLowerCase().includes(q)
            ) ||
            (d.tags || []).some((t) => t.includes(q))
          );
        }
        if (d.type === "credit_card") {
          return (
            d.title.toLowerCase().includes(q) ||
            d.cardholderName.toLowerCase().includes(q) ||
            d.notes?.toLowerCase().includes(q) ||
            (d.customFields || []).some(
              (field) =>
                field.label.toLowerCase().includes(q) ||
                field.value.toLowerCase().includes(q)
            ) ||
            (d.tags || []).some((t) => t.includes(q))
          );
        }
        if (d.type === "identity") {
          return (
            d.title.toLowerCase().includes(q) ||
            d.fullName.toLowerCase().includes(q) ||
            d.email?.toLowerCase().includes(q) ||
            d.phone?.toLowerCase().includes(q) ||
            d.organization?.toLowerCase().includes(q) ||
            d.address?.toLowerCase().includes(q) ||
            d.notes?.toLowerCase().includes(q) ||
            (d.customFields || []).some(
              (field) =>
                field.label.toLowerCase().includes(q) ||
                field.value.toLowerCase().includes(q)
            ) ||
            (d.tags || []).some((t) => t.includes(q))
          );
        }
        return false;
      }),
    [activeTag, items, searchQuery, selectedFolderId, showFavoritesOnly]
  );

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

  const getItemIcon = (type: string) => {
    switch (type) {
      case "login":
        return <Globe className="w-5 h-5" />;
      case "secure_note":
        return <FileText className="w-5 h-5" />;
      case "credit_card":
        return <CreditCard className="w-5 h-5" />;
      case "identity":
        return <User className="w-5 h-5" />;
      default:
        return <Globe className="w-5 h-5" />;
    }
  };

  const getItemSubtitle = (item: DecryptedVaultItem) => {
    const d = item.data;
    if (d.type === "login") return d.username;
    if (d.type === "secure_note") return "Güvenli Not";
    if (d.type === "credit_card") return `•••• ${d.cardNumber.slice(-4)}`;
    if (d.type === "identity") return d.email || d.fullName;
    return "";
  };

  const renderCustomFields = (item: DecryptedVaultItem) => {
    const fields = item.data.customFields || [];
    if (fields.length === 0) {
      return null;
    }

    return (
      <div>
        <span className="text-sm text-text-secondary block mb-2">Özel Alanlar</span>
        <div className="space-y-2">
          {fields.map((field) => (
            <div
              key={field.id}
              className="flex items-center justify-between gap-3 rounded-lg bg-abyss px-3 py-2"
            >
              <span className="text-sm text-text-secondary">{field.label}</span>
              <div className="flex items-center gap-2">
                <span className="text-sm font-[family-name:var(--font-mono)] text-text-primary">
                  {field.concealed ? "••••••••" : field.value}
                </span>
                <button
                  onClick={() => copyToClipboard(field.value, `field-${item.id}-${field.id}`)}
                  className="text-text-muted hover:text-text-primary transition-colors"
                  title="Alanı kopyala"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-center">
          <div className="w-12 h-12 border-2 border-accent/30 border-t-accent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-text-secondary">Kasa çözülüyor...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-6 gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            placeholder="Kasa içinde ara..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-surface border border-border rounded-xl py-2.5 pl-10 pr-4 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 transition-colors"
          />
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="bg-accent hover:bg-accent-dim text-midnight font-semibold px-5 py-2.5 rounded-xl flex items-center gap-2 transition-all hover:shadow-lg hover:shadow-accent/20 text-sm shrink-0"
        >
          <Plus className="w-4 h-4" />
          Yeni Öğe
        </button>
      </div>

      {/* Tag Filter Bar */}
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

      {/* Items Grid */}
      {filteredItems.length === 0 ? (
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
        <div className="space-y-2">
          {filteredItems.map((item, index) => (
            <div
              key={item.id}
              className="glass rounded-xl p-4 hover:bg-surface-hover transition-all duration-200 group animate-slide-up cursor-pointer"
              style={{ animationDelay: `${index * 30}ms` }}
              onClick={() => setSelectedItem(selectedItem?.id === item.id ? null : item)}
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-accent/10 text-accent flex items-center justify-center shrink-0">
                  {getItemIcon(item.data.type)}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="font-medium text-text-primary truncate">
                    {item.data.title}
                  </p>
                  <div className="flex items-center gap-2">
                    <p className="text-sm text-text-secondary truncate">
                      {getItemSubtitle(item)}
                    </p>
                    {item.data.tags && item.data.tags.length > 0 && (
                      <div className="flex items-center gap-1 shrink-0">
                        {item.data.tags.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent/70 border border-accent/20"
                          >
                            {tag}
                          </span>
                        ))}
                        {item.data.tags.length > 3 && (
                          <span className="text-[10px] text-text-muted">
                            +{item.data.tags.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {item.data.type === "login" && (
                    <>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          copyToClipboard(item.data.type === "login" ? item.data.username : "", `user-${item.id}`);
                        }}
                        className="p-2 rounded-lg hover:bg-surface text-text-muted hover:text-text-primary transition-colors"
                        title="Kullanıcı adını kopyala"
                      >
                        <User className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          copyToClipboard(item.data.type === "login" ? item.data.password : "", `pass-${item.id}`);
                        }}
                        className="p-2 rounded-lg hover:bg-surface text-text-muted hover:text-text-primary transition-colors"
                        title="Şifreyi kopyala"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                      {item.data.totpSecret && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (selectedTotpState?.code && selectedItem?.id === item.id) {
                              void copyToClipboard(selectedTotpState.code, `totp-${item.id}`);
                            }
                          }}
                          className="p-2 rounded-lg hover:bg-surface text-text-muted hover:text-text-primary transition-colors"
                          title="TOTP kodunu kopyala"
                        >
                          <KeyRound className="w-4 h-4" />
                        </button>
                      )}
                    </>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditItem(item);
                    }}
                    className="p-2 rounded-lg hover:bg-surface text-text-muted hover:text-text-primary transition-colors"
                    title="Düzenle"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setHistoryItem(item);
                    }}
                    className="p-2 rounded-lg hover:bg-surface text-text-muted hover:text-text-primary transition-colors"
                    title="Geçmiş"
                  >
                    <History className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFavorite(item.id);
                    }}
                    className={`p-2 rounded-lg hover:bg-surface transition-colors ${
                      item.favorite ? "text-warning" : "text-text-muted hover:text-text-primary"
                    }`}
                    title="Favori"
                  >
                    <Star className="w-4 h-4" fill={item.favorite ? "currentColor" : "none"} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm("Bu öğeyi silmek istediğinize emin misiniz?")) {
                        deleteVaultItem(item.id)
                          .then(() => {
                            notify.deleted();
                          })
                          .catch((error) => {
                            notify.error(getErrorMessage(error, "Öğe silinemedi"));
                          });
                      }
                    }}
                    className="p-2 rounded-lg hover:bg-danger/10 text-text-muted hover:text-danger transition-colors"
                    title="Sil"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {copiedId?.includes(item.id) && (
                  <span className="text-xs text-accent animate-fade-in">Kopyalandı!</span>
                )}
              </div>

              {/* Expanded Detail */}
              {selectedItem?.id === item.id && (
                <div
                  className="mt-4 pt-4 border-t border-border animate-slide-up"
                  onClick={(e) => e.stopPropagation()}
                >
                  {item.data.type === "login" && (
                    <div className="space-y-3">
                      {item.data.url && (
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-text-secondary">URL</span>
                          <a
                            href={item.data.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-accent hover:underline flex items-center gap-1"
                          >
                            {item.data.url}
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      )}
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-text-secondary">Kullanıcı</span>
                        <span className="text-sm font-[family-name:var(--font-mono)]">
                          {item.data.username}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-text-secondary">Şifre</span>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-[family-name:var(--font-mono)]">
                            {revealedPasswords.has(item.id)
                              ? item.data.password
                              : "••••••••••"}
                          </span>
                          <button
                            onClick={() => togglePasswordVisibility(item.id)}
                            className="text-text-muted hover:text-text-primary"
                          >
                            {revealedPasswords.has(item.id) ? (
                              <EyeOff className="w-3.5 h-3.5" />
                            ) : (
                              <Eye className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </div>
                            {item.data.totpSecret && (
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm text-text-secondary">Authenticator Kodu</span>
                            {selectedTotpState?.code && selectedItem?.id === item.id && (
                              <button
                                onClick={() =>
                                  copyToClipboard(selectedTotpState.code!, `totp-${item.id}`)
                                }
                                className="text-xs text-accent hover:underline"
                              >
                                Kopyala
                              </button>
                            )}
                          </div>
                          <div className="rounded-lg bg-abyss p-3">
                            {selectedTotpState?.error ? (
                              <p className="text-sm text-danger">{selectedTotpState.error}</p>
                            ) : (
                              <>
                                <div className="flex items-center justify-between">
                                  <span className="text-lg font-[family-name:var(--font-mono)] tracking-[0.3em] text-text-primary">
                                    {selectedTotpState?.code
                                      ? `${selectedTotpState.code.slice(0, 3)} ${selectedTotpState.code.slice(3)}`
                                      : "------"}
                                  </span>
                                  <span className="text-xs text-text-muted">
                                    {selectedTotpState?.expiresIn ?? 0}s
                                  </span>
                                </div>
                                <div className="mt-2 h-1.5 rounded-full bg-surface overflow-hidden">
                                  <div
                                    className="h-full rounded-full bg-accent transition-all"
                                    style={{
                                      width: `${((selectedTotpState?.expiresIn ?? 0) / 30) * 100}%`,
                                    }}
                                  />
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      )}
                      {item.data.notes && (
                        <div>
                          <span className="text-sm text-text-secondary block mb-1">Notlar</span>
                          <p className="text-sm text-text-primary bg-abyss rounded-lg p-3">
                            {item.data.notes}
                          </p>
                        </div>
                      )}
                      {renderCustomFields(item)}
                    </div>
                  )}

                  {item.data.type === "secure_note" && (
                    <div className="space-y-3">
                      <div className="bg-abyss rounded-lg p-4">
                        <p className="text-sm text-text-primary whitespace-pre-wrap">
                          {item.data.content}
                        </p>
                      </div>
                      {renderCustomFields(item)}
                    </div>
                  )}

                  {item.data.type === "credit_card" && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-text-secondary">Kart Sahibi</span>
                        <span className="text-sm">{item.data.cardholderName}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-text-secondary">Kart No</span>
                        <span className="text-sm font-[family-name:var(--font-mono)]">
                          {revealedPasswords.has(item.id)
                            ? item.data.cardNumber
                            : `•••• •••• •••• ${item.data.cardNumber.slice(-4)}`}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-text-secondary">Son Kullanma</span>
                        <span className="text-sm">
                          {item.data.expMonth}/{item.data.expYear}
                        </span>
                      </div>
                      {item.data.notes && (
                        <div>
                          <span className="text-sm text-text-secondary block mb-1">Notlar</span>
                          <p className="text-sm text-text-primary bg-abyss rounded-lg p-3">
                            {item.data.notes}
                          </p>
                        </div>
                      )}
                      {renderCustomFields(item)}
                    </div>
                  )}

                  {item.data.type === "identity" && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-text-secondary">Tam Ad</span>
                        <span className="text-sm">{item.data.fullName}</span>
                      </div>
                      {item.data.email && (
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-text-secondary">E-posta</span>
                          <span className="text-sm font-[family-name:var(--font-mono)]">
                            {item.data.email}
                          </span>
                        </div>
                      )}
                      {item.data.phone && (
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-text-secondary">Telefon</span>
                          <span className="text-sm font-[family-name:var(--font-mono)]">
                            {item.data.phone}
                          </span>
                        </div>
                      )}
                      {item.data.organization && (
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-text-secondary">Kurum</span>
                          <span className="text-sm">{item.data.organization}</span>
                        </div>
                      )}
                      {item.data.address && (
                        <div>
                          <span className="text-sm text-text-secondary block mb-1">Adres</span>
                          <p className="text-sm text-text-primary bg-abyss rounded-lg p-3 whitespace-pre-wrap">
                            {item.data.address}
                          </p>
                        </div>
                      )}
                      {item.data.notes && (
                        <div>
                          <span className="text-sm text-text-secondary block mb-1">Notlar</span>
                          <p className="text-sm text-text-primary bg-abyss rounded-lg p-3 whitespace-pre-wrap">
                            {item.data.notes}
                          </p>
                        </div>
                      )}
                      {renderCustomFields(item)}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
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
