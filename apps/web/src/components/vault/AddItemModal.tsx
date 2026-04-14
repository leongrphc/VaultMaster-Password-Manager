"use client";

import { useState } from "react";
import {
  X,
  Globe,
  FileText,
  CreditCard,
  User,
  Eye,
  EyeOff,
  Wand2,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { generatePassword } from "@vaultmaster/crypto";
import type { VaultItemCustomField, VaultItemData } from "@vaultmaster/shared";
import TagInput from "./TagInput";
import CustomFieldsEditor from "./CustomFieldsEditor";
import { useShallow } from "zustand/shallow";
import { getErrorMessage } from "@/lib/api";
import { notify } from "@/lib/notify";

interface AddItemModalProps {
  onClose: () => void;
}

type ItemType = "login" | "secure_note" | "credit_card" | "identity";

export default function AddItemModal({ onClose }: AddItemModalProps) {
  const { createVaultItem, folders, items, selectedFolderId } = useStore(
    useShallow((state) => ({
      createVaultItem: state.createVaultItem,
      folders: state.folders,
      items: state.items,
      selectedFolderId: state.selectedFolderId,
    }))
  );

  const [type, setType] = useState<ItemType>("login");
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Login fields
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totpSecret, setTotpSecret] = useState("");
  const [notes, setNotes] = useState("");

  // Secure note fields
  const [noteContent, setNoteContent] = useState("");

  // Credit card fields
  const [cardholderName, setCardholderName] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [expMonth, setExpMonth] = useState("");
  const [expYear, setExpYear] = useState("");
  const [cvv, setCvv] = useState("");

  // Identity fields
  const [fullName, setFullName] = useState("");
  const [identityEmail, setIdentityEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [organization, setOrganization] = useState("");
  const [address, setAddress] = useState("");
  const [identityNotes, setIdentityNotes] = useState("");

  // Folder
  const [folderId, setFolderId] = useState<string | null>(selectedFolderId);

  // Tags
  const [tags, setTags] = useState<string[]>([]);
  const [customFields, setCustomFields] = useState<VaultItemCustomField[]>([]);

  const allTags = Array.from(
    new Set(items.flatMap((i) => i.data.tags || []))
  ).sort();

  const handleGeneratePassword = () => {
    setPassword(generatePassword({ length: 20 }));
    setShowPassword(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setSaving(true);

    try {
      let data: VaultItemData;
      const sanitizedCustomFields = customFields
        .map((field) => ({
          ...field,
          label: field.label.trim(),
          value: field.value.trim(),
        }))
        .filter((field) => field.label && field.value);

      if (type === "login") {
        data = {
          type: "login",
          title,
          url: url || undefined,
          username,
          password,
          totpSecret: totpSecret.trim() || undefined,
          notes: notes || undefined,
          tags: tags.length > 0 ? tags : undefined,
          customFields:
            sanitizedCustomFields.length > 0 ? sanitizedCustomFields : undefined,
        };
      } else if (type === "secure_note") {
        data = {
          type: "secure_note",
          title,
          content: noteContent,
          tags: tags.length > 0 ? tags : undefined,
          customFields:
            sanitizedCustomFields.length > 0 ? sanitizedCustomFields : undefined,
        };
      } else if (type === "credit_card") {
        data = {
          type: "credit_card",
          title,
          cardholderName,
          cardNumber,
          expMonth,
          expYear,
          cvv,
          notes: notes || undefined,
          tags: tags.length > 0 ? tags : undefined,
          customFields:
            sanitizedCustomFields.length > 0 ? sanitizedCustomFields : undefined,
        };
      } else {
        data = {
          type: "identity",
          title,
          fullName,
          email: identityEmail || undefined,
          phone: phone || undefined,
          organization: organization || undefined,
          address: address || undefined,
          notes: identityNotes || undefined,
          tags: tags.length > 0 ? tags : undefined,
          customFields:
            sanitizedCustomFields.length > 0 ? sanitizedCustomFields : undefined,
        };
      }

      await createVaultItem(data, folderId);
      notify.saved();
      onClose();
    } catch (err) {
      console.error("Kaydetme hatası:", err);
      notify.error(getErrorMessage(err, "Öğe kaydedilemedi"));
    } finally {
      setSaving(false);
    }
  };

  const typeOptions = [
    { value: "login" as const, label: "Giriş Bilgisi", icon: Globe },
    { value: "secure_note" as const, label: "Güvenli Not", icon: FileText },
    { value: "credit_card" as const, label: "Kredi Kartı", icon: CreditCard },
    { value: "identity" as const, label: "Kimlik", icon: User },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-midnight/80 backdrop-blur-sm" onClick={onClose} />

      <div className="relative glass rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto animate-slide-up">
        <div className="sticky top-0 glass rounded-t-2xl flex items-center justify-between p-5 border-b border-border z-10">
          <h2 className="text-lg font-bold font-[family-name:var(--font-display)]">
            Yeni Öğe Ekle
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-surface text-text-muted hover:text-text-primary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-5">
          {/* Type Selector */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {typeOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setType(opt.value)}
                className={`flex flex-col items-center gap-2 p-3 rounded-xl border text-sm transition-all ${
                  type === opt.value
                    ? "bg-accent/10 border-accent/30 text-accent"
                    : "bg-surface border-border text-text-secondary hover:border-border"
                }`}
              >
                <opt.icon className="w-5 h-5" />
                {opt.label}
              </button>
            ))}
          </div>

          {/* Title */}
          <div>
            <label className="block text-sm text-text-secondary mb-2">Başlık</label>
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-abyss border border-border rounded-xl py-2.5 px-4 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 transition-colors"
              placeholder="ör. Google Hesabı"
            />
          </div>

          {/* Folder */}
          {folders.length > 0 && (
            <div>
              <label className="block text-sm text-text-secondary mb-2">Klasör</label>
              <select
                value={folderId || ""}
                onChange={(e) => setFolderId(e.target.value || null)}
                className="w-full bg-abyss border border-border rounded-xl py-2.5 px-4 text-sm text-text-primary focus:outline-none focus:border-accent/50 transition-colors"
              >
                <option value="">Klasör yok</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Tags */}
          <TagInput tags={tags} onChange={setTags} suggestions={allTags} />

          {/* Login Fields */}
          {type === "login" && (
            <>
              <div>
                <label className="block text-sm text-text-secondary mb-2">URL</label>
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="w-full bg-abyss border border-border rounded-xl py-2.5 px-4 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 transition-colors"
                  placeholder="https://example.com"
                />
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-2">Kullanıcı Adı</label>
                <input
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-abyss border border-border rounded-xl py-2.5 px-4 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 transition-colors"
                  placeholder="kullanici@email.com"
                />
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-2">Şifre</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      required
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full bg-abyss border border-border rounded-xl py-2.5 px-4 pr-10 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 transition-colors font-[family-name:var(--font-mono)]"
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={handleGeneratePassword}
                    className="p-2.5 rounded-xl bg-accent/10 hover:bg-accent/20 text-accent border border-accent/20 transition-all shrink-0"
                    title="Şifre üret"
                  >
                    <Wand2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-2">
                  TOTP Secret / otpauth URI
                </label>
                <input
                  value={totpSecret}
                  onChange={(e) => setTotpSecret(e.target.value)}
                  className="w-full bg-abyss border border-border rounded-xl py-2.5 px-4 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 transition-colors font-[family-name:var(--font-mono)]"
                  placeholder="JBSWY3DPEHPK3PXP veya otpauth://..."
                />
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-2">Notlar</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="w-full bg-abyss border border-border rounded-xl py-2.5 px-4 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 transition-colors resize-none"
                  placeholder="Opsiyonel notlar..."
                />
              </div>
            </>
          )}

          {/* Secure Note Fields */}
          {type === "secure_note" && (
            <div>
              <label className="block text-sm text-text-secondary mb-2">Not İçeriği</label>
              <textarea
                required
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
                rows={6}
                className="w-full bg-abyss border border-border rounded-xl py-2.5 px-4 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 transition-colors resize-none"
                placeholder="Güvenli notunuzu yazın..."
              />
            </div>
          )}

          {/* Credit Card Fields */}
          {type === "credit_card" && (
            <>
              <div>
                <label className="block text-sm text-text-secondary mb-2">Kart Sahibi</label>
                <input
                  required
                  value={cardholderName}
                  onChange={(e) => setCardholderName(e.target.value)}
                  className="w-full bg-abyss border border-border rounded-xl py-2.5 px-4 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 transition-colors"
                  placeholder="Ad Soyad"
                />
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-2">Kart Numarası</label>
                <input
                  required
                  value={cardNumber}
                  onChange={(e) => setCardNumber(e.target.value.replace(/\D/g, ""))}
                  maxLength={16}
                  className="w-full bg-abyss border border-border rounded-xl py-2.5 px-4 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 transition-colors font-[family-name:var(--font-mono)]"
                  placeholder="1234 5678 9012 3456"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm text-text-secondary mb-2">Ay</label>
                  <input
                    required
                    value={expMonth}
                    onChange={(e) => setExpMonth(e.target.value.replace(/\D/g, ""))}
                    maxLength={2}
                    className="w-full bg-abyss border border-border rounded-xl py-2.5 px-4 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 transition-colors text-center"
                    placeholder="MM"
                  />
                </div>
                <div>
                  <label className="block text-sm text-text-secondary mb-2">Yıl</label>
                  <input
                    required
                    value={expYear}
                    onChange={(e) => setExpYear(e.target.value.replace(/\D/g, ""))}
                    maxLength={4}
                    className="w-full bg-abyss border border-border rounded-xl py-2.5 px-4 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 transition-colors text-center"
                    placeholder="YYYY"
                  />
                </div>
                <div>
                  <label className="block text-sm text-text-secondary mb-2">CVV</label>
                  <input
                    required
                    type="password"
                    value={cvv}
                    onChange={(e) => setCvv(e.target.value.replace(/\D/g, ""))}
                    maxLength={4}
                    className="w-full bg-abyss border border-border rounded-xl py-2.5 px-4 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 transition-colors text-center"
                    placeholder="•••"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-2">Notlar</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="w-full bg-abyss border border-border rounded-xl py-2.5 px-4 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 transition-colors resize-none"
                  placeholder="Kart ile ilgili notlar..."
                />
              </div>
            </>
          )}

          {type === "identity" && (
            <>
              <div>
                <label className="block text-sm text-text-secondary mb-2">Tam Ad</label>
                <input
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full bg-abyss border border-border rounded-xl py-2.5 px-4 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 transition-colors"
                  placeholder="Ad Soyad"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-sm text-text-secondary mb-2">E-posta</label>
                  <input
                    value={identityEmail}
                    onChange={(e) => setIdentityEmail(e.target.value)}
                    className="w-full bg-abyss border border-border rounded-xl py-2.5 px-4 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 transition-colors"
                    placeholder="ornek@email.com"
                  />
                </div>
                <div>
                  <label className="block text-sm text-text-secondary mb-2">Telefon</label>
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full bg-abyss border border-border rounded-xl py-2.5 px-4 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 transition-colors"
                    placeholder="+90 5xx xxx xx xx"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-2">Kurum / Şirket</label>
                <input
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  className="w-full bg-abyss border border-border rounded-xl py-2.5 px-4 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 transition-colors"
                  placeholder="Şirket adı"
                />
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-2">Adres</label>
                <textarea
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  rows={3}
                  className="w-full bg-abyss border border-border rounded-xl py-2.5 px-4 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 transition-colors resize-none"
                  placeholder="Adres bilgisi"
                />
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-2">Notlar</label>
                <textarea
                  value={identityNotes}
                  onChange={(e) => setIdentityNotes(e.target.value)}
                  rows={3}
                  className="w-full bg-abyss border border-border rounded-xl py-2.5 px-4 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 transition-colors resize-none"
                  placeholder="Kimlik ile ilgili notlar..."
                />
              </div>
            </>
          )}

          <CustomFieldsEditor fields={customFields} onChange={setCustomFields} />

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-border text-text-secondary hover:text-text-primary hover:bg-surface transition-all text-sm"
            >
              İptal
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 bg-accent hover:bg-accent-dim text-midnight font-semibold py-2.5 rounded-xl transition-all disabled:opacity-50 text-sm"
            >
              {saving ? "Şifreleniyor..." : "Kaydet"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
