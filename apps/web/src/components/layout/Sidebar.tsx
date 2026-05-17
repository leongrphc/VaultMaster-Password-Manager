"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import {
  Shield,
  KeyRound,
  FolderClosed,
  Star,
  Wand2,
  Settings,
  LogOut,
  ChevronLeft,
  FolderPlus,
  ShieldAlert,
  Lock,
  Trash2,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { api, getErrorMessage } from "@/lib/api";
import { notify } from "@/lib/notify";
import { useShallow } from "zustand/shallow";

interface SidebarProps {
  isOpen: boolean;
  isMobileOpen: boolean;
  onToggle: () => void;
  onMobileClose: () => void;
}

export default function Sidebar({ isOpen, isMobileOpen, onToggle, onMobileClose }: SidebarProps) {
  const pathname = usePathname();
  const {
    folders,
    items,
    tokens,
    selectedFolderId,
    setSelectedFolderId,
    showFavoritesOnly,
    setShowFavoritesOnly,
    createFolder,
    deleteFolder,
    logout,
    lockVault,
  } = useStore(
    useShallow((state) => ({
      folders: state.folders,
      items: state.items,
      tokens: state.tokens,
      selectedFolderId: state.selectedFolderId,
      setSelectedFolderId: state.setSelectedFolderId,
      showFavoritesOnly: state.showFavoritesOnly,
      setShowFavoritesOnly: state.setShowFavoritesOnly,
      createFolder: state.createFolder,
      deleteFolder: state.deleteFolder,
      logout: state.logout,
      lockVault: state.lockVault,
    }))
  );

  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  const handleLogout = async () => {
    if (tokens) {
      try {
        await api.auth.logout(tokens.accessToken, tokens.refreshToken);
      } catch {}
    }
    logout();
    window.location.assign("/");
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;

    try {
      await createFolder(newFolderName.trim());
      setNewFolderName("");
      setShowNewFolder(false);
      notify.success("Klasör oluşturuldu");
    } catch (e) {
      console.error("Klasör oluşturma hatası:", e);
      notify.error(getErrorMessage(e, "Klasör oluşturulamadı"));
    }
  };

  const handleDeleteFolder = async (
    event: React.MouseEvent<HTMLButtonElement>,
    folder: (typeof folders)[number]
  ) => {
    event.preventDefault();
    event.stopPropagation();

    const affectedItemCount = folder._count?.items ?? 0;
    const message =
      affectedItemCount > 0
        ? `"${folder.name}" klasörü silinecek. ${affectedItemCount} öğe klasörden çıkarılacak. Devam etmek istiyor musunuz?`
        : `"${folder.name}" klasörünü silmek istiyor musunuz?`;

    if (!window.confirm(message)) {
      return;
    }

    try {
      await deleteFolder(folder.id);
      notify.deleted(`Klasör: ${folder.name}`);
    } catch (error) {
      notify.error(getErrorMessage(error, "Klasör silinemedi"));
    }
  };

  const totalItems = items.length;
  const favoriteCount = useMemo(
    () => items.reduce((count, item) => count + (item.favorite ? 1 : 0), 0),
    [items]
  );

  const closeMobileSidebar = () => {
    onMobileClose();
  };
  const showExpandedSidebar = isOpen || isMobileOpen;

  const navItems = [
    {
      label: "Tüm Öğeler",
      icon: KeyRound,
      href: "/vault",
      count: totalItems,
      onClick: () => {
        setSelectedFolderId(null);
        setShowFavoritesOnly(false);
      },
      active: pathname === "/vault" && !selectedFolderId && !showFavoritesOnly,
    },
    {
      label: "Favoriler",
      icon: Star,
      href: "/vault",
      count: favoriteCount,
      onClick: () => {
        setShowFavoritesOnly(true);
      },
      active: pathname === "/vault" && showFavoritesOnly,
    },
    {
      label: "Şifre Üretici",
      icon: Wand2,
      href: "/vault/generator",
      onClick: () => undefined,
      active: pathname === "/vault/generator",
    },
    {
      label: "Sağlık Raporu",
      icon: ShieldAlert,
      href: "/vault/health",
      onClick: () => undefined,
      active: pathname === "/vault/health",
    },
    {
      label: "Çöp Kutusu",
      icon: Trash2,
      href: "/vault/trash",
      onClick: () => undefined,
      active: pathname === "/vault/trash",
    },
    {
      label: "Ayarlar",
      icon: Settings,
      href: "/vault/settings",
      onClick: () => undefined,
      active: pathname === "/vault/settings",
    },
  ];

  return (
    <div
      className={`fixed inset-0 z-30 bg-midnight/70 backdrop-blur-sm transition-opacity duration-300 lg:bg-transparent lg:backdrop-blur-none ${
        isMobileOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0 lg:pointer-events-auto lg:opacity-100"
      }`}
      onMouseDown={onMobileClose}
    >
      <aside
        className={`fixed left-0 top-0 flex h-screen flex-col border-r border-border bg-abyss transition-all duration-300 ${
          isMobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        } ${showExpandedSidebar ? "w-72" : "w-72 lg:w-16"}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
      {/* Header */}
      <div className="p-4 flex items-center justify-between border-b border-border">
        {showExpandedSidebar && (
          <div className="flex items-center gap-3 animate-fade-in">
            <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center">
              <Shield className="w-5 h-5 text-accent" />
            </div>
            <span className="font-bold font-[family-name:var(--font-display)] text-sm">
              Vault<span className="text-gradient">Master</span>
            </span>
          </div>
        )}
        <button
          type="button"
          onClick={onToggle}
          aria-label={isOpen ? "Kenar çubuğunu daralt" : "Kenar çubuğunu genişlet"}
          aria-expanded={isOpen}
          className={`p-2 rounded-lg hover:bg-surface transition-colors text-text-muted hover:text-text-primary ${
            !isOpen ? "mx-auto" : ""
          }`}
        >
          <ChevronLeft
            className={`w-4 h-4 transition-transform duration-300 ${
              !isOpen ? "rotate-180" : ""
            }`}
          />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-3 space-y-1">
        {navItems.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            onClick={() => {
              item.onClick();
              closeMobileSidebar();
            }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all ${
              item.active
                ? "bg-accent/10 text-accent"
                : "text-text-secondary hover:text-text-primary hover:bg-surface"
            }`}
            title={!isOpen ? item.label : undefined}
          >
            <item.icon className="w-4.5 h-4.5 shrink-0" />
            {showExpandedSidebar && (
              <>
                <span className="flex-1 text-left">{item.label}</span>
                {item.count !== undefined && (
                  <span className="text-xs text-text-muted bg-surface px-2 py-0.5 rounded-md">
                    {item.count}
                  </span>
                )}
              </>
            )}
          </Link>
        ))}

        {/* Folders */}
        {showExpandedSidebar && (
          <div className="mt-6">
            <div className="flex items-center justify-between px-3 mb-2">
              <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
                Klasörler
              </span>
              <button
                type="button"
                onClick={() => setShowNewFolder(true)}
                aria-label="Yeni klasör oluştur"
                className="p-1 rounded hover:bg-surface text-text-muted hover:text-accent transition-colors"
              >
                <FolderPlus className="w-3.5 h-3.5" />
              </button>
            </div>

            {showNewFolder && (
              <form onSubmit={handleCreateFolder} className="px-2 mb-2">
                <input
                  autoFocus
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onBlur={() => {
                    if (!newFolderName.trim()) setShowNewFolder(false);
                  }}
                  placeholder="Klasör adı..."
                  className="w-full bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50"
                />
              </form>
            )}

            {folders.map((folder) => (
              <div key={folder.id} className="group relative">
                <Link
                  href="/vault"
                  onClick={() => {
                    setSelectedFolderId(
                      selectedFolderId === folder.id ? null : folder.id
                    );
                    closeMobileSidebar();
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-all ${
                    selectedFolderId === folder.id
                      ? "bg-accent/10 text-accent"
                      : "text-text-secondary hover:text-text-primary hover:bg-surface"
                  }`}
                >
                  <FolderClosed className="w-4 h-4 shrink-0" />
                  <span className="flex-1 text-left truncate pr-8">{folder.name}</span>
                  {folder._count && (
                    <span className="text-xs text-text-muted">
                      {folder._count.items}
                    </span>
                  )}
                </Link>
                <button
                  type="button"
                  onClick={(event) => void handleDeleteFolder(event, folder)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-text-muted opacity-0 transition-all hover:bg-danger/10 hover:text-danger group-hover:opacity-100"
                  title={`${folder.name} klasörünü sil`}
                  aria-label={`${folder.name} klasörünü sil`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-border space-y-1">
        <button
          onClick={() => lockVault()}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-text-secondary hover:text-accent hover:bg-accent/5 transition-all"
          title={!isOpen ? "Kasayı Kilitle" : undefined}
        >
          <Lock className="w-4.5 h-4.5 shrink-0" />
          {showExpandedSidebar && <span>Kasayı Kilitle</span>}
        </button>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-text-secondary hover:text-danger hover:bg-danger/5 transition-all"
          title={!isOpen ? "Çıkış Yap" : undefined}
        >
          <LogOut className="w-4.5 h-4.5 shrink-0" />
          {showExpandedSidebar && <span>Çıkış Yap</span>}
        </button>
      </div>
      </aside>
    </div>
  );
}
