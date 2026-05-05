"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CreditCard,
  FileText,
  Gauge,
  Globe,
  Heart,
  KeyRound,
  Lock,
  Plus,
  Search,
  Settings,
  Sparkles,
  Trash2,
  User,
} from "lucide-react";
import { useStore, type DecryptedVaultItem } from "@/lib/store";
import { searchVaultItems } from "@/lib/search";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useShallow } from "zustand/shallow";

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onNewItem?: () => void;
  onOpenItem?: (item: DecryptedVaultItem) => void;
}

type Command =
  | { id: string; type: "item"; label: string; detail: string; item: DecryptedVaultItem }
  | { id: string; type: "action"; label: string; detail: string; icon: React.ReactNode; run: () => void };

export default function CommandPalette({ isOpen, onClose, onNewItem, onOpenItem }: CommandPaletteProps) {
  const router = useRouter();
  const { items, folders, lockVault, setSelectedFolderId, setShowFavoritesOnly, setSearchQuery } = useStore(
    useShallow((state) => ({
      items: state.items,
      folders: state.folders,
      lockVault: state.lockVault,
      setSelectedFolderId: state.setSelectedFolderId,
      setShowFavoritesOnly: state.setShowFavoritesOnly,
      setSearchQuery: state.setSearchQuery,
    }))
  );
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const commands = useMemo(() => {
    const actions: Command[] = [
      {
        id: "new-item",
        type: "action",
        label: "Yeni öğe oluştur",
        detail: "Login, kart, not veya kimlik ekle",
        icon: <Plus className="w-4 h-4" />,
        run: () => onNewItem?.(),
      },
      {
        id: "generator",
        type: "action",
        label: "Şifre üretici",
        detail: "Güçlü parola oluştur",
        icon: <KeyRound className="w-4 h-4" />,
        run: () => router.push("/vault/generator"),
      },
      {
        id: "health",
        type: "action",
        label: "Şifre sağlığı",
        detail: "Zayıf ve sızmış parolaları kontrol et",
        icon: <Gauge className="w-4 h-4" />,
        run: () => router.push("/vault/health"),
      },
      {
        id: "favorites",
        type: "action",
        label: "Favorileri göster",
        detail: "Yıldızlı kayıtları filtrele",
        icon: <Heart className="w-4 h-4" />,
        run: () => {
          router.push("/vault");
          setShowFavoritesOnly(true);
        },
      },
      {
        id: "trash",
        type: "action",
        label: "Çöp kutusu",
        detail: "Silinen öğeleri yönet",
        icon: <Trash2 className="w-4 h-4" />,
        run: () => router.push("/vault/trash"),
      },
      {
        id: "settings",
        type: "action",
        label: "Ayarlar",
        detail: "Güvenlik, cihazlar ve veri yönetimi",
        icon: <Settings className="w-4 h-4" />,
        run: () => router.push("/vault/settings"),
      },
      {
        id: "lock",
        type: "action",
        label: "Kasayı kilitle",
        detail: "Master key'i oturumdan temizle",
        icon: <Lock className="w-4 h-4" />,
        run: lockVault,
      },
      ...folders.map<Command>((folder) => ({
        id: `folder-${folder.id}`,
        type: "action",
        label: `Klasör: ${folder.name}`,
        detail: "Bu klasöre git",
        icon: <FileText className="w-4 h-4" />,
        run: () => {
          router.push("/vault");
          setSelectedFolderId(folder.id);
        },
      })),
    ];

    const matchingItems = searchVaultItems(items, query)
      .slice(0, 8)
      .map<Command>((item) => ({
        id: `item-${item.id}`,
        type: "item",
        label: item.data.title,
        detail: getItemDetail(item),
        item,
      }));

    const matchingActions = actions.filter((action) => {
      if (!query.trim()) return true;
      const value = `${action.label} ${action.detail}`.toLocaleLowerCase("tr");
      return value.includes(query.toLocaleLowerCase("tr"));
    });

    return [...matchingItems, ...matchingActions].slice(0, 12);
  }, [folders, items, lockVault, onNewItem, query, router, setSelectedFolderId, setShowFavoritesOnly]);

  const updateQuery = (value: string) => {
    setQuery(value);
    setSelectedIndex(0);
  };

  useKeyboardShortcuts([
    {
      key: "Escape",
      enabled: isOpen,
      action: onClose,
    },
    {
      key: "ArrowDown",
      enabled: isOpen,
      action: () => setSelectedIndex((index) => Math.min(index + 1, commands.length - 1)),
    },
    {
      key: "ArrowUp",
      enabled: isOpen,
      action: () => setSelectedIndex((index) => Math.max(index - 1, 0)),
    },
    {
      key: "Enter",
      enabled: isOpen,
      action: () => runCommand(commands[selectedIndex], onClose, onOpenItem, setSearchQuery),
    },
  ]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-midnight/70 px-4 pt-[12vh] backdrop-blur-xl" onMouseDown={onClose}>
      <div
        className="w-full max-w-2xl overflow-hidden rounded-[28px] border border-accent/20 bg-abyss/95 shadow-2xl shadow-black/50 animate-scale-in"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="border-b border-border/80 p-4">
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 focus-within:border-accent/50">
            <Search className="w-5 h-5 text-accent" />
            <input
              autoFocus
              value={query}
              onChange={(event) => updateQuery(event.target.value)}
              placeholder="Kasa, klasör veya aksiyon ara..."
              className="w-full bg-transparent text-base text-text-primary placeholder:text-text-muted focus:outline-none"
            />
            <span className="rounded-lg border border-border px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-text-muted">Esc</span>
          </div>
        </div>

        <div className="max-h-[55vh] overflow-y-auto p-2">
          {commands.length === 0 ? (
            <div className="p-10 text-center text-text-secondary">
              <Sparkles className="mx-auto mb-3 h-8 w-8 text-text-muted" />
              Sonuç bulunamadı
            </div>
          ) : (
            commands.map((command, index) => (
              <button
                key={command.id}
                type="button"
                onClick={() => runCommand(command, onClose, onOpenItem, setSearchQuery)}
                className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition-all ${
                  selectedIndex === index
                    ? "bg-accent text-midnight shadow-lg shadow-accent/10"
                    : "text-text-primary hover:bg-surface"
                }`}
              >
                <span
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                    selectedIndex === index ? "bg-midnight/10" : "bg-accent/10 text-accent"
                  }`}
                >
                  {command.type === "item" ? getItemIcon(command.item) : command.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{command.label}</span>
                  <span className={`block truncate text-sm ${selectedIndex === index ? "text-midnight/65" : "text-text-secondary"}`}>
                    {command.detail}
                  </span>
                </span>
                {selectedIndex === index && <span className="text-xs font-bold uppercase tracking-[0.18em]">Enter</span>}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function runCommand(
  command: Command | undefined,
  onClose: () => void,
  onOpenItem: ((item: DecryptedVaultItem) => void) | undefined,
  setSearchQuery: (query: string) => void
) {
  if (!command) return;

  if (command.type === "item") {
    setSearchQuery(command.item.data.title);
    onOpenItem?.(command.item);
  } else {
    command.run();
  }

  onClose();
}

function getItemDetail(item: DecryptedVaultItem) {
  const data = item.data;
  if (data.type === "login") return data.username || data.url || "Login";
  if (data.type === "credit_card") return `Kart •••• ${data.cardNumber.slice(-4)}`;
  if (data.type === "identity") return data.email || data.fullName;
  return "Güvenli not";
}

function getItemIcon(item: DecryptedVaultItem) {
  if (item.data.type === "login") return <Globe className="w-4 h-4" />;
  if (item.data.type === "credit_card") return <CreditCard className="w-4 h-4" />;
  if (item.data.type === "identity") return <User className="w-4 h-4" />;
  return <FileText className="w-4 h-4" />;
}
