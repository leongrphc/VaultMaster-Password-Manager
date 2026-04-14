import { toast } from "sonner";

/**
 * Merkezi bildirim yardımcısı.
 * Tüm uygulama genelinde tutarlı mesajlar ve stil sağlar.
 */
export const notify = {
  success: (message: string) => toast.success(message),

  error: (message: string) => toast.error(message),

  warning: (message: string) => toast.warning(message),

  info: (message: string) => toast.info(message),

  /** Panoya kopyalama bildirimi */
  copied: (label?: string) =>
    toast.success(label ? `${label} panoya kopyalandı` : "Panoya kopyalandı"),

  /** Öğe silme bildirimi */
  deleted: (label?: string) =>
    toast.success(label ? `"${label}" silindi` : "Öğe silindi"),

  /** Öğe kaydetme bildirimi */
  saved: () => toast.success("Öğe kaydedildi"),

  /** Öğe güncelleme bildirimi */
  updated: () => toast.success("Öğe güncellendi"),

  /** Öğe geri yükleme bildirimi */
  restored: () => toast.success("Öğe geri yüklendi"),

  /** Kalıcı silme bildirimi */
  purged: () => toast.success("Öğe kalıcı olarak silindi"),

  /** Oturum süresi dolma bildirimi */
  sessionExpired: () =>
    toast.error("Oturum süresi doldu. Lütfen tekrar giriş yapın."),

  /** Çevrimdışı mod bildirimi */
  offlineMode: () =>
    toast.warning(
      "Çevrimdışı veriler kullanılıyor. Değişiklikler senkronize edilmeyebilir."
    ),

  /** Vault yükleme hatası */
  vaultLoadError: () => toast.error("Kasa yüklenirken hata oluştu."),
};
