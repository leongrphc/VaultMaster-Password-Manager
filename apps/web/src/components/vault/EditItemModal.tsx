"use client";

import { useState, useEffect } from "react";
import { X, Globe, FileText, CreditCard, User, Eye, EyeOff, Wand2 } from "lucide-react";
import { useStore, type DecryptedVaultItem } from "@/lib/store";
import { generatePassword } from "@vaultmaster/crypto";
import type { VaultItemCustomField, VaultItemData } from "@vaultmaster/shared";
import TagInput from "./TagInput";
import CustomFieldsEditor from "./CustomFieldsEditor";
import { getErrorMessage } from "@/lib/api";
import { notify } from "@/lib/notify";
import { useShallow } from "zustand/shallow";

interface EditItemModalProps {
  item: DecryptedVaultItem;
  onClose: () => void;
}

export default function EditItemModal({ item, onClose }: EditItemModalProps) {
  const { updateVaultItemFull, folders, items } = useStore(
    useShallow((state) => ({
      updateVaultItemFull: state.updateVaultItemFull,
      folders: state.folders,
      items: state.items,
    }))
  );

  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totpSecret, setTotpSecret] = useState("");
  const [notes, setNotes] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [cardholderName, setCardholderName] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [expMonth, setExpMonth] = useState("");
  const [expYear, setExpYear] = useState("");
  const [cvv, setCvv] = useState("");
  const [fullName, setFullName] = useState("");
  const [identityEmail, setIdentityEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [organization, setOrganization] = useState("");
  const [address, setAddress] = useState("");
  const [identityNotes, setIdentityNotes] = useState("");
  const [folderId, setFolderId] = useState<string | null>(item.folderId);
  const [tags, setTags] = useState<string[]>([]);
  const [customFields, setCustomFields] = useState<VaultItemCustomField[]>([]);

  const allTags = Array.from(
    new Set(items.flatMap((i) => i.data.tags || []))
  ).sort();

  useEffect(() => {
    const d = item.data;
    setTitle(d.title);
    setFolderId(item.folderId);

    if (d.type === "login") {
      setUrl(d.url || "");
      setUsername(d.username);
      setPassword(d.password);
      setTotpSecret(d.totpSecret || "");
      setNotes(d.notes || "");
    } else if (d.type === "secure_note") {
      setNoteContent(d.content);
    } else if (d.type === "credit_card") {
      setCardholderName(d.cardholderName);
      setCardNumber(d.cardNumber);
      setExpMonth(d.expMonth);
      setExpYear(d.expYear);
      setCvv(d.cvv);
      setNotes(d.notes || "");
    } else if (d.type === "identity") {
      setFullName(d.fullName);
      setIdentityEmail(d.email || "");
      setPhone(d.phone || "");
      setOrganization(d.organization || "");
      setAddress(d.address || "");
      setIdentityNotes(d.notes || "");
    }

    setTags(d.tags || []);
    setCustomFields(d.customFields || []);
  }, [item]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setSaving(true);
    try {
      let data: VaultItemData;
      const type = item.data.type;
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
          totpSecret: totpSecret || undefined,
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

      await updateVaultItemFull(item.id, data, folderId);
      onClose();
    } catch (err) {
      console.error("Güncelleme hatası:", err);
      notify.error(getErrorMessage(err, "Öğe güncellenemedi"));
    } finally {
      setSaving(false);
    }
  };

  const type = item.data.type;

  const typeLabels = {
    login: { label: "Giriş Bilgisi", icon: Globe },
    secure_note: { label: "Güvenli Not", icon: FileText },
    credit_card: { label: "Kredi Kartı", icon: CreditCard },
    identity: { label: "Kimlik", icon: User },
  };

  const TypeIcon = typeLabels[type].icon;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-midnight/80 backdrop-blur-sm" onClick={onClose} />

      <div className="relative glass rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto animate-slide-up">
        <div className="sticky top-0 glass rounded-t-2xl flex items-center justify-between p-5 border-b border-border z-10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
              <TypeIcon className="w-4 h-4 text-accent" />
            </div>
            <h2 className="text-lg font-bold font-[family-name:var(--font-display)]">
              Düzenle
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-surface text-text-muted hover:text-text-primary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-5">
          <div>
            <label className="block text-sm text-text-secondary mb-2">Başlık</label>
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-abyss border border-border rounded-xl py-2.5 px-4 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 transition-colors"
            />
          </div>

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
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Tags */}
          <TagInput tags={tags} onChange={setTags} suggestions={allTags} />

          {type === "login" && (
            <>
              <div>
                <label className="block text-sm text-text-secondary mb-2">URL</label>
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="w-full bg-abyss border border-border rounded-xl py-2.5 px-4 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-2">Kullanıcı Adı</label>
                <input
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-abyss border border-border rounded-xl py-2.5 px-4 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 transition-colors"
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
                    onClick={() => { setPassword(generatePassword({ length: 20 })); setShowPassword(true); }}
                    className="p-2.5 rounded-xl bg-accent/10 hover:bg-accent/20 text-accent border border-accent/20 transition-all shrink-0"
                    title="Yeni şifre üret"
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
                />
              </div>
            </>
          )}

          {type === "secure_note" && (
            <div>
              <label className="block text-sm text-text-secondary mb-2">Not İçeriği</label>
              <textarea
                required
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
                rows={6}
                className="w-full bg-abyss border border-border rounded-xl py-2.5 px-4 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 transition-colors resize-none"
              />
            </div>
          )}

          {type === "credit_card" && (
            <>
              <div>
                <label className="block text-sm text-text-secondary mb-2">Kart Sahibi</label>
                <input required value={cardholderName} onChange={(e) => setCardholderName(e.target.value)} className="w-full bg-abyss border border-border rounded-xl py-2.5 px-4 text-sm text-text-primary focus:outline-none focus:border-accent/50 transition-colors" />
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-2">Kart Numarası</label>
                <input required value={cardNumber} onChange={(e) => setCardNumber(e.target.value.replace(/\D/g, ""))} maxLength={16} className="w-full bg-abyss border border-border rounded-xl py-2.5 px-4 text-sm text-text-primary focus:outline-none focus:border-accent/50 transition-colors font-[family-name:var(--font-mono)]" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm text-text-secondary mb-2">Ay</label>
                  <input required value={expMonth} onChange={(e) => setExpMonth(e.target.value.replace(/\D/g, ""))} maxLength={2} className="w-full bg-abyss border border-border rounded-xl py-2.5 px-4 text-sm text-text-primary focus:outline-none focus:border-accent/50 transition-colors text-center" />
                </div>
                <div>
                  <label className="block text-sm text-text-secondary mb-2">Yıl</label>
                  <input required value={expYear} onChange={(e) => setExpYear(e.target.value.replace(/\D/g, ""))} maxLength={4} className="w-full bg-abyss border border-border rounded-xl py-2.5 px-4 text-sm text-text-primary focus:outline-none focus:border-accent/50 transition-colors text-center" />
                </div>
                <div>
                  <label className="block text-sm text-text-secondary mb-2">CVV</label>
                  <input required type="password" value={cvv} onChange={(e) => setCvv(e.target.value.replace(/\D/g, ""))} maxLength={4} className="w-full bg-abyss border border-border rounded-xl py-2.5 px-4 text-sm text-text-primary focus:outline-none focus:border-accent/50 transition-colors text-center" />
                </div>
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-2">Notlar</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="w-full bg-abyss border border-border rounded-xl py-2.5 px-4 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 transition-colors resize-none"
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
                  className="w-full bg-abyss border border-border rounded-xl py-2.5 px-4 text-sm text-text-primary focus:outline-none focus:border-accent/50 transition-colors"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-sm text-text-secondary mb-2">E-posta</label>
                  <input
                    value={identityEmail}
                    onChange={(e) => setIdentityEmail(e.target.value)}
                    className="w-full bg-abyss border border-border rounded-xl py-2.5 px-4 text-sm text-text-primary focus:outline-none focus:border-accent/50 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm text-text-secondary mb-2">Telefon</label>
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full bg-abyss border border-border rounded-xl py-2.5 px-4 text-sm text-text-primary focus:outline-none focus:border-accent/50 transition-colors"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-2">Kurum / Şirket</label>
                <input
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  className="w-full bg-abyss border border-border rounded-xl py-2.5 px-4 text-sm text-text-primary focus:outline-none focus:border-accent/50 transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-2">Adres</label>
                <textarea
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  rows={3}
                  className="w-full bg-abyss border border-border rounded-xl py-2.5 px-4 text-sm text-text-primary focus:outline-none focus:border-accent/50 transition-colors resize-none"
                />
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-2">Notlar</label>
                <textarea
                  value={identityNotes}
                  onChange={(e) => setIdentityNotes(e.target.value)}
                  rows={3}
                  className="w-full bg-abyss border border-border rounded-xl py-2.5 px-4 text-sm text-text-primary focus:outline-none focus:border-accent/50 transition-colors resize-none"
                />
              </div>
            </>
          )}

          <CustomFieldsEditor fields={customFields} onChange={setCustomFields} />

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-border text-text-secondary hover:text-text-primary hover:bg-surface transition-all text-sm">
              İptal
            </button>
            <button type="submit" disabled={saving} className="flex-1 bg-accent hover:bg-accent-dim text-midnight font-semibold py-2.5 rounded-xl transition-all disabled:opacity-50 text-sm">
              {saving ? "Şifreleniyor..." : "Güncelle"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
