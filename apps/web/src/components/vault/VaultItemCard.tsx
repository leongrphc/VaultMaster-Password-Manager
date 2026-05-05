"use client";

import {
  Copy,
  CreditCard,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Globe,
  History,
  KeyRound,
  Pencil,
  Star,
  Trash2,
  User,
} from "lucide-react";
import type { DecryptedVaultItem, VaultViewMode } from "@/lib/store";

interface TotpDisplayState {
  code: string | null;
  expiresIn: number;
  error: string | null;
}

interface VaultItemCardProps {
  item: DecryptedVaultItem;
  viewMode: VaultViewMode;
  isSelected: boolean;
  isPasswordRevealed: boolean;
  copiedId: string | null;
  totpState: TotpDisplayState | null;
  index: number;
  onSelect: () => void;
  onCopy: (text: string, id: string) => void;
  onTogglePassword: () => void;
  onEdit: () => void;
  onHistory: () => void;
  onToggleFavorite: () => void;
  selectionMode?: boolean;
  isChecked?: boolean;
  onCheckedChange?: () => void;
  onDelete: () => void;
}

export default function VaultItemCard({
  item,
  viewMode,
  isSelected,
  isPasswordRevealed,
  copiedId,
  totpState,
  index,
  onSelect,
  onCopy,
  onTogglePassword,
  onEdit,
  onHistory,
  onToggleFavorite,
  selectionMode = false,
  isChecked = false,
  onCheckedChange,
  onDelete,
}: VaultItemCardProps) {
  const isGrid = viewMode === "grid";
  const isCompact = viewMode === "compact";

  return (
    <div
      className={`glass rounded-xl hover:bg-surface-hover transition-all duration-200 group animate-slide-up cursor-pointer focus-within:ring-2 focus-within:ring-accent/30 ${
        isGrid ? "p-4 min-h-48" : isCompact ? "p-3" : "p-4"
      }`}
      style={{ animationDelay: `${Math.min(index, 12) * 25}ms` }}
      onClick={onSelect}
    >
      <div className={`flex gap-4 ${isGrid ? "items-start" : "items-center"}`}>
        {selectionMode && (
          <input
            type="checkbox"
            checked={isChecked}
            onChange={() => onCheckedChange?.()}
            onClick={(event) => event.stopPropagation()}
            className="h-4 w-4 accent-accent"
            aria-label={`${item.data.title} seç`}
          />
        )}
        <div className="w-10 h-10 rounded-xl bg-accent/10 text-accent flex items-center justify-center shrink-0">
          {getItemIcon(item.data.type)}
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-medium text-text-primary truncate">{item.data.title}</p>
          <div className={`flex ${isGrid ? "flex-col items-start" : "items-center"} gap-2`}>
            <p className="text-sm text-text-secondary truncate">{getItemSubtitle(item)}</p>
            {item.data.tags && item.data.tags.length > 0 && !isCompact && (
              <div className="flex items-center gap-1 shrink-0 flex-wrap">
                {item.data.tags.slice(0, isGrid ? 4 : 3).map((tag) => (
                  <span
                    key={tag}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent/70 border border-accent/20"
                  >
                    {tag}
                  </span>
                ))}
                {item.data.tags.length > (isGrid ? 4 : 3) && (
                  <span className="text-[10px] text-text-muted">
                    +{item.data.tags.length - (isGrid ? 4 : 3)}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
          {item.data.type === "login" && (
            <>
              <IconButton
                onClick={() => onCopy(item.data.type === "login" ? item.data.username : "", `user-${item.id}`)}
                label="Kullanıcı adını kopyala"
              >
                <User className="w-4 h-4" />
              </IconButton>
              <IconButton
                onClick={() => onCopy(item.data.type === "login" ? item.data.password : "", `pass-${item.id}`)}
                label="Şifreyi kopyala"
              >
                <Copy className="w-4 h-4" />
              </IconButton>
              {item.data.totpSecret && (
                <IconButton
                  onClick={() => {
                    if (totpState?.code) {
                      onCopy(totpState.code, `totp-${item.id}`);
                    }
                  }}
                  label="TOTP kodunu kopyala"
                >
                  <KeyRound className="w-4 h-4" />
                </IconButton>
              )}
            </>
          )}
          <IconButton onClick={onEdit} label="Düzenle">
            <Pencil className="w-4 h-4" />
          </IconButton>
          <IconButton onClick={onHistory} label="Geçmiş">
            <History className="w-4 h-4" />
          </IconButton>
          <IconButton
            onClick={onToggleFavorite}
            label={item.favorite ? "Favoriden çıkar" : "Favoriye ekle"}
            className={item.favorite ? "text-warning" : ""}
          >
            <Star className="w-4 h-4" fill={item.favorite ? "currentColor" : "none"} />
          </IconButton>
          <IconButton onClick={onDelete} label="Sil" className="hover:text-danger hover:bg-danger/10">
            <Trash2 className="w-4 h-4" />
          </IconButton>
        </div>

        {copiedId?.includes(item.id) && (
          <span className="text-xs text-accent animate-fade-in">Kopyalandı!</span>
        )}
      </div>

      {isSelected && !isCompact && (
        <div className="mt-4 pt-4 border-t border-border animate-slide-up" onClick={(event) => event.stopPropagation()}>
          {renderItemDetails(item, isPasswordRevealed, totpState, onCopy, onTogglePassword)}
        </div>
      )}
    </div>
  );
}

function IconButton({
  children,
  label,
  className = "",
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  className?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={`p-2 rounded-lg hover:bg-surface text-text-muted hover:text-text-primary transition-colors ${className}`}
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  );
}

function renderItemDetails(
  item: DecryptedVaultItem,
  isPasswordRevealed: boolean,
  totpState: TotpDisplayState | null,
  onCopy: (text: string, id: string) => void,
  onTogglePassword: () => void
) {
  if (item.data.type === "login") {
    return (
      <div className="space-y-3">
        {item.data.url && (
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-text-secondary">URL</span>
            <a
              href={item.data.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-accent hover:underline flex items-center gap-1 truncate"
            >
              {item.data.url}
              <ExternalLink className="w-3 h-3 shrink-0" />
            </a>
          </div>
        )}
        <DetailRow label="Kullanıcı" value={item.data.username} mono />
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm text-text-secondary">Şifre</span>
          <div className="flex items-center gap-2">
            <span className="text-sm font-[family-name:var(--font-mono)]">
              {isPasswordRevealed ? item.data.password : "••••••••••"}
            </span>
            <button
              type="button"
              onClick={onTogglePassword}
              className="text-text-muted hover:text-text-primary"
              aria-label={isPasswordRevealed ? "Şifreyi gizle" : "Şifreyi göster"}
            >
              {isPasswordRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
        {item.data.totpSecret && (
          <TotpBlock itemId={item.id} state={totpState} onCopy={onCopy} />
        )}
        {item.data.notes && <NotesBlock label="Notlar" value={item.data.notes} />}
        {renderCustomFields(item, onCopy)}
      </div>
    );
  }

  if (item.data.type === "secure_note") {
    return (
      <div className="space-y-3">
        <NotesBlock value={item.data.content} />
        {renderCustomFields(item, onCopy)}
      </div>
    );
  }

  if (item.data.type === "credit_card") {
    return (
      <div className="space-y-3">
        <DetailRow label="Kart Sahibi" value={item.data.cardholderName} />
        <DetailRow
          label="Kart No"
          value={isPasswordRevealed ? item.data.cardNumber : `•••• •••• •••• ${item.data.cardNumber.slice(-4)}`}
          mono
        />
        <DetailRow label="Son Kullanma" value={`${item.data.expMonth}/${item.data.expYear}`} />
        {item.data.notes && <NotesBlock label="Notlar" value={item.data.notes} />}
        {renderCustomFields(item, onCopy)}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <DetailRow label="Tam Ad" value={item.data.fullName} />
      {item.data.email && <DetailRow label="E-posta" value={item.data.email} mono />}
      {item.data.phone && <DetailRow label="Telefon" value={item.data.phone} mono />}
      {item.data.organization && <DetailRow label="Kurum" value={item.data.organization} />}
      {item.data.address && <NotesBlock label="Adres" value={item.data.address} />}
      {item.data.notes && <NotesBlock label="Notlar" value={item.data.notes} />}
      {renderCustomFields(item, onCopy)}
    </div>
  );
}

function DetailRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-text-secondary">{label}</span>
      <span className={`text-sm text-right ${mono ? "font-[family-name:var(--font-mono)]" : ""}`}>{value}</span>
    </div>
  );
}

function NotesBlock({ label, value }: { label?: string; value: string }) {
  return (
    <div>
      {label && <span className="text-sm text-text-secondary block mb-1">{label}</span>}
      <p className="text-sm text-text-primary bg-abyss rounded-lg p-3 whitespace-pre-wrap">{value}</p>
    </div>
  );
}

function TotpBlock({
  itemId,
  state,
  onCopy,
}: {
  itemId: string;
  state: TotpDisplayState | null;
  onCopy: (text: string, id: string) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-text-secondary">Authenticator Kodu</span>
        {state?.code && (
          <button type="button" onClick={() => onCopy(state.code!, `totp-${itemId}`)} className="text-xs text-accent hover:underline">
            Kopyala
          </button>
        )}
      </div>
      <div className="rounded-lg bg-abyss p-3">
        {state?.error ? (
          <p className="text-sm text-danger">{state.error}</p>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <span className="text-lg font-[family-name:var(--font-mono)] tracking-[0.3em] text-text-primary">
                {state?.code ? `${state.code.slice(0, 3)} ${state.code.slice(3)}` : "------"}
              </span>
              <span className="text-xs text-text-muted">{state?.expiresIn ?? 0}s</span>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-surface overflow-hidden">
              <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${((state?.expiresIn ?? 0) / 30) * 100}%` }} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function renderCustomFields(item: DecryptedVaultItem, onCopy: (text: string, id: string) => void) {
  const fields = item.data.customFields || [];
  if (fields.length === 0) {
    return null;
  }

  return (
    <div>
      <span className="text-sm text-text-secondary block mb-2">Özel Alanlar</span>
      <div className="space-y-2">
        {fields.map((field) => (
          <div key={field.id} className="flex items-center justify-between gap-3 rounded-lg bg-abyss px-3 py-2">
            <span className="text-sm text-text-secondary">{field.label}</span>
            <div className="flex items-center gap-2">
              <span className="text-sm font-[family-name:var(--font-mono)] text-text-primary">
                {field.concealed ? "••••••••" : field.value}
              </span>
              <button
                type="button"
                onClick={() => onCopy(field.value, `field-${item.id}-${field.id}`)}
                className="text-text-muted hover:text-text-primary transition-colors"
                title="Alanı kopyala"
                aria-label="Alanı kopyala"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function getItemIcon(type: string) {
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
}

function getItemSubtitle(item: DecryptedVaultItem) {
  const data = item.data;
  if (data.type === "login") return data.username;
  if (data.type === "secure_note") return "Güvenli Not";
  if (data.type === "credit_card") return `•••• ${data.cardNumber.slice(-4)}`;
  if (data.type === "identity") return data.email || data.fullName;
  return "";
}
