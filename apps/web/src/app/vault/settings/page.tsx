"use client";

import { useEffect, useRef, useState } from "react";
import {
  Settings,
  Clock,
  Shield,
  Download,
  Upload,
  FileJson,
  FileSpreadsheet,
  Check,
  AlertTriangle,
  User,
  Mail,
  CalendarDays,
  ChevronRight,
  Loader2,
  Puzzle,
  WifiOff,
  Monitor,
  Smartphone,
  RefreshCcw,
  Pencil,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { importMasterKey, encryptJSON, decryptJSON } from "@vaultmaster/crypto";
import { api } from "@/lib/api";
import type { AuditEventResponse, DeviceResponse, VaultItemData } from "@vaultmaster/shared";
import TwoFactorSettings from "@/components/vault/TwoFactorSettings";
import AccountSecurityPanel from "@/components/vault/AccountSecurityPanel";
import PlaintextExportConfirmModal from "@/components/vault/PlaintextExportConfirmModal";
import { useShallow } from "zustand/shallow";

interface ImportedBackupItem {
  data: VaultItemData;
  folderId?: string | null;
  favorite?: boolean;
}

interface ImportedBackupPayload {
  version?: string;
  folders?: Array<{ id: string; name: string }>;
  items?: ImportedBackupItem[];
}

export default function SettingsPage() {
  const {
    userEmail,
    lockTimeoutMinutes,
    setLockTimeout,
    items,
    folders,
    tokens,
    masterKeyBase64,
    lastSyncedAt,
    isUsingOfflineData,
    createFolder,
    createVaultItem,
    currentDeviceId,
    runWithValidAccessToken,
  } = useStore(
    useShallow((state) => ({
      userEmail: state.userEmail,
      lockTimeoutMinutes: state.lockTimeoutMinutes,
      setLockTimeout: state.setLockTimeout,
      items: state.items,
      folders: state.folders,
      tokens: state.tokens,
      masterKeyBase64: state.masterKeyBase64,
      lastSyncedAt: state.lastSyncedAt,
      isUsingOfflineData: state.isUsingOfflineData,
      createFolder: state.createFolder,
      createVaultItem: state.createVaultItem,
      currentDeviceId: state.currentDeviceId,
      runWithValidAccessToken: state.runWithValidAccessToken,
    }))
  );

  const [activeTab, setActiveTab] = useState<"general" | "security" | "data">("general");
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [showPlaintextCsvConfirm, setShowPlaintextCsvConfirm] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [devices, setDevices] = useState<DeviceResponse[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEventResponse[]>([]);
  const [securityLoading, setSecurityLoading] = useState(false);
  const [securityError, setSecurityError] = useState<string | null>(null);
  const [securitySuccess, setSecuritySuccess] = useState<string | null>(null);
  const [revokingDeviceId, setRevokingDeviceId] = useState<string | null>(null);
  const [revokingOthers, setRevokingOthers] = useState(false);
  const [renamingDeviceId, setRenamingDeviceId] = useState<string | null>(null);
  const [editingDeviceId, setEditingDeviceId] = useState<string | null>(null);
  const [deviceNameDraft, setDeviceNameDraft] = useState("");
  const [securityReloadKey, setSecurityReloadKey] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const timeoutOptions = [
    { value: 1, label: "1 dakika" },
    { value: 5, label: "5 dakika" },
    { value: 10, label: "10 dakika" },
    { value: 15, label: "15 dakika" },
    { value: 30, label: "30 dakika" },
    { value: 60, label: "1 saat" },
    { value: 0, label: "Hiçbir zaman" },
  ];

  const handleExportJSON = async () => {
    if (!masterKeyBase64) return;

    try {
      const exportData = {
        version: "2.0",
        exportDate: new Date().toISOString(),
        itemCount: items.length,
        folderCount: folders.length,
        folders: folders.map((folder) => ({
          id: folder.id,
          name: folder.name,
        })),
        items: items.map((item) => ({
          data: item.data,
          folderId: item.folderId,
          favorite: item.favorite,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        })),
      };

      const masterKey = await importMasterKey(masterKeyBase64);
      const encrypted = await encryptJSON(exportData, masterKey);

      const blob = new Blob(
        [JSON.stringify({ encrypted: true, ...encrypted }, null, 2)],
        { type: "application/json" }
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `vaultmaster-export-${new Date().toISOString().split("T")[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);

      setExportStatus("success");
      setTimeout(() => setExportStatus(null), 3000);
    } catch (e) {
      console.error("Export hatası:", e);
      setExportStatus("error");
      setTimeout(() => setExportStatus(null), 3000);
    }
  };

  const loginItems = items.filter((i) => i.data.type === "login");

  const handleExportCSVRequest = () => {
    if (loginItems.length === 0) {
      setExportStatus("empty");
      setTimeout(() => setExportStatus(null), 3000);
      return;
    }

    setShowPlaintextCsvConfirm(true);
  };

  const performExportCSV = () => {
    const header = "title,url,username,password,notes";
    const rows = loginItems.map((item) => {
      const d = item.data as Extract<VaultItemData, { type: "login" }>;
      const escape = (s: string) => `"${(s || "").replace(/"/g, '""')}"`;
      return [
        escape(d.title),
        escape(d.url || ""),
        escape(d.username),
        escape(d.password),
        escape(d.notes || ""),
      ].join(",");
    });

    const csv = [header, ...rows].join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vaultmaster-export-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    setShowPlaintextCsvConfirm(false);
    setExportStatus("success");
    setTimeout(() => setExportStatus(null), 3000);
  };

  const handleImportCSV = async (file: File) => {
    setImporting(true);
    setImportStatus(null);

    try {
      const text = await file.text();
      const lines = text.split("\n").filter((l) => l.trim());

      if (lines.length < 2) {
        setImportStatus("empty");
        setImporting(false);
        return;
      }

      const header = lines[0].toLowerCase();
      const isChrome = header.includes("name") && header.includes("url") && header.includes("username") && header.includes("password");
      const isGeneric = header.includes("title") && header.includes("username") && header.includes("password");

      if (!isChrome && !isGeneric) {
        setImportStatus("invalid");
        setImporting(false);
        return;
      }

      let imported = 0;

      for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.length < 3) continue;

        let loginData: VaultItemData;

        if (isChrome) {
          loginData = {
            type: "login",
            title: values[0] || values[1] || "Imported",
            url: values[1] || "",
            username: values[2] || "",
            password: values[3] || "",
            notes: "",
          };
        } else {
          loginData = {
            type: "login",
            title: values[0] || "Imported",
            url: values[1] || "",
            username: values[2] || "",
            password: values[3] || "",
            notes: values[4] || "",
          };
        }

        await createVaultItem(loginData);
        imported++;
      }

      setImportStatus(`${imported} öğe başarıyla içe aktarıldı`);
    } catch (e) {
      console.error("Import hatası:", e);
      setImportStatus("error");
    }

    setImporting(false);
  };

  const parseCSVLine = (line: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      if (inQuotes) {
        if (line[i] === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          current += line[i];
        }
      } else {
        if (line[i] === '"') {
          inQuotes = true;
        } else if (line[i] === ",") {
          result.push(current.trim());
          current = "";
        } else {
          current += line[i];
        }
      }
    }
    result.push(current.trim());
    return result;
  };

  const handleImportJSON = async (file: File) => {
    setImporting(true);
    setImportStatus(null);
    if (!masterKeyBase64) {
      setImportStatus("error");
      setImporting(false);
      return;
    }

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);

      if (!parsed.encrypted || !parsed.ciphertext || !parsed.iv) {
        setImportStatus("invalid_json");
        setImporting(false);
        return;
      }

      const masterKey = await importMasterKey(masterKeyBase64);
      let decryptedData: ImportedBackupPayload;
      try {
        decryptedData = await decryptJSON(parsed.ciphertext, parsed.iv, masterKey);
      } catch {
        setImportStatus("decrypt_error");
        setImporting(false);
        return;
      }

      if (!decryptedData.items || !Array.isArray(decryptedData.items)) {
        setImportStatus("invalid_json");
        setImporting(false);
        return;
      }

      const folderMap = new Map<string, string | null>();
      const existingFolders = new Map(
        folders.map((folder) => [folder.name.trim().toLowerCase(), folder.id])
      );

      for (const folder of decryptedData.folders ?? []) {
        const normalizedName = folder.name.trim().toLowerCase();
        const existingFolderId = existingFolders.get(normalizedName);

        if (existingFolderId) {
          folderMap.set(folder.id, existingFolderId);
          continue;
        }

        const createdFolder = await createFolder(folder.name);
        existingFolders.set(normalizedName, createdFolder.id);
        folderMap.set(folder.id, createdFolder.id);
      }

      let imported = 0;

      for (const item of decryptedData.items) {
        const mappedFolderId = item.folderId
          ? folderMap.get(item.folderId) ?? null
          : null;

        await createVaultItem(item.data, mappedFolderId, item.favorite ?? false);
        imported++;
      }

      setImportStatus(`${imported} öğe başarıyla içe aktarıldı (JSON)`);
    } catch (e) {
      console.error("JSON Import hatası:", e);
      setImportStatus("error");
    }

    setImporting(false);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.name.endsWith(".csv")) {
      handleImportCSV(file);
    } else if (file.name.endsWith(".json")) {
      handleImportJSON(file);
    } else {
      setImportStatus("unsupported");
    }

    e.target.value = "";
  };

  const tabs = [
    { id: "general" as const, label: "Genel", icon: Settings },
    { id: "security" as const, label: "Güvenlik", icon: Shield },
    { id: "data" as const, label: "Veri Yönetimi", icon: Download },
  ];

  useEffect(() => {
    let cancelled = false;

    if (activeTab !== "security" || !tokens) {
      return;
    }

    const loadSecurityOverview = async () => {
      setSecurityLoading(true);
      setSecurityError(null);
      setSecuritySuccess(null);

      try {
        const [devicesResponse, auditResponse] = await Promise.all([
          runWithValidAccessToken(
            (accessToken) =>
              api.devices.getAll(accessToken) as Promise<{ data: DeviceResponse[] }>
          ),
          runWithValidAccessToken(
            (accessToken) =>
              api.auditEvents.getAll(accessToken, 12) as Promise<{ data: AuditEventResponse[] }>
          ),
        ]);

        if (cancelled) {
          return;
        }

        setDevices(devicesResponse.data);
        setAuditEvents(auditResponse.data);
      } catch (error) {
        if (cancelled) {
          return;
        }

        console.error("Güvenlik verileri yüklenemedi:", error);
        setSecurityError(
          error instanceof Error ? error.message : "Güvenlik verileri yüklenemedi"
        );
      } finally {
        if (!cancelled) {
          setSecurityLoading(false);
        }
      }
    };

    void loadSecurityOverview();

    return () => {
      cancelled = true;
    };
  }, [activeTab, tokens, securityReloadKey, runWithValidAccessToken]);

  const handleRevokeDevice = async (deviceId: string) => {
    if (!tokens || deviceId === currentDeviceId) {
      return;
    }

    const confirmed = window.confirm(
      "Bu oturumu sonlandırmak istediğinize emin misiniz?"
    );
    if (!confirmed) {
      return;
    }

    setRevokingDeviceId(deviceId);
    setSecurityError(null);
    setSecuritySuccess(null);
    try {
      await runWithValidAccessToken((accessToken) =>
        api.devices.revoke(deviceId, accessToken)
      );
      setSecuritySuccess("Seçilen oturum sonlandırıldı");
      setSecurityReloadKey((value) => value + 1);
    } catch (error) {
      console.error("Oturum sonlandırılamadı:", error);
      setSecurityError(
        error instanceof Error ? error.message : "Oturum sonlandırılamadı"
      );
    } finally {
      setRevokingDeviceId(null);
    }
  };

  const handleRenameDevice = async (deviceId: string) => {
    if (!deviceNameDraft.trim()) {
      setSecurityError("Cihaz adı boş olamaz");
      return;
    }

    setRenamingDeviceId(deviceId);
    setSecurityError(null);
    setSecuritySuccess(null);
    try {
      await runWithValidAccessToken((accessToken) =>
        api.devices.update(
          deviceId,
          { deviceName: deviceNameDraft.trim() },
          accessToken
        )
      );
      setEditingDeviceId(null);
      setDeviceNameDraft("");
      setSecuritySuccess("Cihaz adı güncellendi");
      setSecurityReloadKey((value) => value + 1);
    } catch (error) {
      console.error("Cihaz adı güncellenemedi:", error);
      setSecurityError(
        error instanceof Error ? error.message : "Cihaz adı güncellenemedi"
      );
    } finally {
      setRenamingDeviceId(null);
    }
  };

  const handleRevokeOtherDevices = async () => {
    if (!tokens || !currentDeviceId) {
      return;
    }

    const otherDevicesCount = devices.filter((device) => device.id !== currentDeviceId).length;
    if (otherDevicesCount === 0) {
      return;
    }

    const confirmed = window.confirm(
      "Bu cihaz dışındaki tüm oturumlar kapatılacak. Devam etmek istiyor musunuz?"
    );
    if (!confirmed) {
      return;
    }

    setRevokingOthers(true);
    setSecurityError(null);
    setSecuritySuccess(null);
    try {
      const response = (await runWithValidAccessToken((accessToken) =>
        api.devices.revokeOthers(currentDeviceId, accessToken)
      )) as { data: { revokedCount: number } };

      setSecuritySuccess(
        `${response.data.revokedCount} oturum kapatıldı`
      );
      setSecurityReloadKey((value) => value + 1);
    } catch (error) {
      console.error("Diğer oturumlar kapatılamadı:", error);
      setSecurityError(
        error instanceof Error ? error.message : "Diğer oturumlar kapatılamadı"
      );
    } finally {
      setRevokingOthers(false);
    }
  };

  const formatDateTime = (value: string) =>
    new Intl.DateTimeFormat("tr-TR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(value));

  const getDeviceIcon = (type: string) =>
    type === "mobile" ? (
      <Smartphone className="w-4 h-4 text-accent" />
    ) : (
      <Monitor className="w-4 h-4 text-accent" />
    );

  const getDeviceLabel = (type: string) => {
    if (type === "mobile") {
      return "Mobil";
    }

    if (type === "web") {
      return "Web";
    }

    return "Bilinmiyor";
  };

  const getAuditEventLabel = (event: AuditEventResponse) => {
    const labels: Record<string, string> = {
      "auth.register": "Hesap oluşturuldu",
      "auth.login": "Giriş yapıldı",
      "auth.login.2fa": "2FA ile giriş yapıldı",
      "auth.logout": "Çıkış yapıldı",
      "auth.refresh": "Oturum yenilendi",
      "security.2fa.setup": "2FA kurulumu başlatıldı",
      "security.2fa.enable": "2FA etkinleştirildi",
      "security.2fa.disable": "2FA devre dışı bırakıldı",
      "security.2fa.recovery_codes.regenerate": "Recovery codes yenilendi",
      "security.session.rename": "Cihaz adı güncellendi",
      "security.session.revoke": "Oturum sonlandırıldı",
      "security.session.revoke_others": "Diğer oturumlar kapatıldı",
      "security.password.change": "Ana şifre değiştirildi",
      "security.account.delete": "Hesap silindi",
      "vault.item.create": "Kasa öğesi oluşturuldu",
      "vault.item.update": "Kasa öğesi güncellendi",
      "vault.item.delete": "Kasa öğesi çöp kutusuna taşındı",
      "vault.item.restore": "Kasa öğesi geri yüklendi",
      "vault.item.history.restore": "Geçmiş sürüm geri yüklendi",
      "vault.item.purge": "Kasa öğesi kalıcı silindi",
    };

    return labels[event.action] ?? event.action;
  };

  const getAuditEventContext = (event: AuditEventResponse) => {
    const metadata = event.metadata ?? {};
    const revokedDeviceName =
      typeof metadata.revokedDeviceName === "string" ? metadata.revokedDeviceName : null;
    const nextDeviceName =
      typeof metadata.nextDeviceName === "string" ? metadata.nextDeviceName : null;

    if (event.deviceName) {
      return event.deviceName;
    }

    if (nextDeviceName) {
      return nextDeviceName;
    }

    if (revokedDeviceName) {
      return revokedDeviceName;
    }

    return event.userAgent || "Cihaz bilgisi yok";
  };

  return (
    <div className="max-w-3xl mx-auto">
      <h2 className="text-2xl font-bold mb-8 font-[family-name:var(--font-display)]">
        Ayarlar
      </h2>

      {/* Tab Navigation */}
      <div className="flex gap-1 bg-abyss rounded-xl p-1 mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.id
                ? "bg-surface text-accent shadow-sm"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* General Tab */}
      {activeTab === "general" && (
        <div className="space-y-4 animate-fade-in">
          <div className="glass rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
                <User className="w-5 h-5 text-accent" />
              </div>
              <div>
                <h3 className="font-semibold">Hesap Bilgileri</h3>
                <p className="text-sm text-text-secondary">Hesabınızla ilgili bilgiler</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between py-3 border-b border-border/50">
                <div className="flex items-center gap-3">
                  <Mail className="w-4 h-4 text-text-muted" />
                  <span className="text-sm text-text-secondary">E-posta</span>
                </div>
                <span className="text-sm font-[family-name:var(--font-mono)] text-text-primary">
                  {userEmail || "-"}
                </span>
              </div>
              <div className="flex items-center justify-between py-3 border-b border-border/50">
                <div className="flex items-center gap-3">
                  <CalendarDays className="w-4 h-4 text-text-muted" />
                  <span className="text-sm text-text-secondary">Toplam Öğe</span>
                </div>
                <span className="text-sm font-[family-name:var(--font-mono)] text-accent">
                  {items.length}
                </span>
              </div>
              <div className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <Shield className="w-4 h-4 text-text-muted" />
                  <span className="text-sm text-text-secondary">Şifreleme</span>
                </div>
                <span className="text-xs bg-accent/10 text-accent px-2.5 py-1 rounded-lg font-medium">
                  AES-256-GCM
                </span>
              </div>
            </div>
          </div>

          <div className="glass rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
                <WifiOff className="w-5 h-5 text-accent" />
              </div>
              <div>
                <h3 className="font-semibold">Offline Erişim</h3>
                <p className="text-sm text-text-secondary">
                  Kasa verileri tarayıcıda şifreli snapshot olarak saklanır
                </p>
              </div>
            </div>

            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-surface">
                <span className="text-text-secondary">Durum</span>
                <span className={isUsingOfflineData ? "text-warning" : "text-accent"}>
                  {isUsingOfflineData ? "Offline snapshot kullanılıyor" : "Canlı veri"}
                </span>
              </div>
              <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-surface">
                <span className="text-text-secondary">Son senkronizasyon</span>
                <span className="font-[family-name:var(--font-mono)] text-text-primary">
                  {lastSyncedAt
                    ? new Intl.DateTimeFormat("tr-TR", {
                        dateStyle: "short",
                        timeStyle: "short",
                      }).format(new Date(lastSyncedAt))
                    : "-"}
                </span>
              </div>
            </div>
          </div>

          <div className="glass rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
                <Puzzle className="w-5 h-5 text-accent" />
              </div>
              <div>
                <h3 className="font-semibold">Tarayıcı Eklentisi</h3>
                <p className="text-sm text-text-secondary">
                  Kullanıcı maili girer; eklenti eşleşme bulursa şifreyi doldurmak için onay ister
                </p>
              </div>
            </div>

            <div className="space-y-2 text-sm text-text-secondary">
              <p>1. `pnpm --filter @vaultmaster/extension build` ile eklentiyi derleyin.</p>
              <p>2. Chrome/Firefox içinde `apps/extension/dist` klasörünü yükleyin.</p>
              <p>3. Autofill için VaultMaster web uygulamasını açık ve kilitsiz tutun.</p>
              <p>4. Hedef sitede kullanıcı adını veya maili elle girin; onay gelirse şifre otomatik doldurulur.</p>
            </div>
          </div>
        </div>
      )}

      {/* Security Tab */}
      {activeTab === "security" && (
        <div className="space-y-4 animate-fade-in">
          <div className="glass rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
                <Clock className="w-5 h-5 text-accent" />
              </div>
              <div>
                <h3 className="font-semibold">Otomatik Kilit</h3>
                <p className="text-sm text-text-secondary">
                  Belirli süre hareketsizlik sonrası kasa otomatik kilitlenir
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {timeoutOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setLockTimeout(opt.value)}
                  className={`px-4 py-3 rounded-xl text-sm font-medium transition-all border ${
                    lockTimeoutMinutes === opt.value
                      ? "bg-accent/10 border-accent/40 text-accent"
                      : "bg-surface border-border text-text-secondary hover:border-accent/20 hover:text-text-primary"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {lockTimeoutMinutes === 0 && (
              <div className="mt-4 flex items-start gap-2 bg-warning/5 border border-warning/20 rounded-xl p-3">
                <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                <p className="text-xs text-warning/80">
                  Otomatik kilit devre dışı. Güvenlik için bir zaman aşımı ayarlamanız önerilir.
                </p>
              </div>
            )}
          </div>

          <TwoFactorSettings />
          <AccountSecurityPanel />

          <div className="glass rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
                <Shield className="w-5 h-5 text-accent" />
              </div>
              <div>
                <h3 className="font-semibold">Güvenlik Özeti</h3>
                <p className="text-sm text-text-secondary">Güvenlik yapılandırması</p>
              </div>
            </div>

            <div className="space-y-3">
              {[
                { label: "Uçtan Uca Şifreleme", value: "Aktif", active: true },
                { label: "Sıfır Bilgi Mimarisi", value: "Aktif", active: true },
                { label: "Anahtar Türetme", value: "PBKDF2 (600.000 iterasyon)", active: true },
                { label: "Şifreleme Algoritması", value: "AES-256-GCM", active: true },
                {
                  label: "Otomatik Kilit",
                  value: lockTimeoutMinutes === 0 ? "Devre dışı" : `${lockTimeoutMinutes} dk`,
                  active: lockTimeoutMinutes > 0,
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-surface/50 transition-colors"
                >
                  <span className="text-sm text-text-secondary">{item.label}</span>
                  <span
                    className={`text-xs px-2.5 py-1 rounded-lg font-medium ${
                      item.active
                        ? "bg-accent/10 text-accent"
                        : "bg-warning/10 text-warning"
                    }`}
                  >
                    {item.value}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="glass rounded-2xl p-6">
            <div className="flex items-center justify-between gap-3 mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
                  <Shield className="w-5 h-5 text-accent" />
                </div>
                <div>
                  <h3 className="font-semibold">Cihazlar ve Oturumlar</h3>
                  <p className="text-sm text-text-secondary">
                    Aktif oturumlarınızı gözden geçirin ve şüpheli erişimleri kapatın
                  </p>
                </div>
              </div>

              <button
                onClick={() => setSecurityReloadKey((value) => value + 1)}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-surface text-sm text-text-secondary hover:text-text-primary transition-colors"
              >
                <RefreshCcw className="w-4 h-4" />
                Yenile
              </button>
            </div>

            {securityError && (
              <div className="mb-4 flex items-center gap-2 p-3 rounded-xl bg-danger/5 border border-danger/20 text-danger text-sm">
                <AlertTriangle className="w-4 h-4" />
                {securityError}
              </div>
            )}

            {securitySuccess && (
              <div className="mb-4 flex items-center gap-2 p-3 rounded-xl bg-accent/5 border border-accent/20 text-accent text-sm">
                <Check className="w-4 h-4" />
                {securitySuccess}
              </div>
            )}

            <div className="mb-4 flex justify-end">
              <button
                onClick={handleRevokeOtherDevices}
                disabled={
                  revokingOthers ||
                  !currentDeviceId ||
                  devices.filter((device) => device.id !== currentDeviceId).length === 0
                }
                className="inline-flex items-center gap-2 rounded-xl bg-danger/10 px-4 py-2 text-sm font-medium text-danger hover:bg-danger/20 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {revokingOthers ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Diğer Tüm Oturumları Kapat
              </button>
            </div>

            {securityLoading ? (
              <div className="py-8 flex items-center justify-center text-text-secondary">
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                Oturumlar yükleniyor...
              </div>
            ) : devices.length === 0 ? (
              <div className="py-8 text-center text-sm text-text-secondary bg-surface rounded-xl">
                Aktif cihaz bulunamadı.
              </div>
            ) : (
              <div className="space-y-3">
                {devices.map((device) => {
                  const isCurrentDevice = device.id === currentDeviceId;

                  return (
                    <div
                      key={device.id}
                      className="rounded-2xl border border-border bg-surface/60 p-4"
                    >
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex items-center gap-3 mb-2">
                            <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
                              {getDeviceIcon(device.deviceType)}
                            </div>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                {editingDeviceId === device.id ? (
                                  <input
                                    autoFocus
                                    value={deviceNameDraft}
                                    onChange={(event) => setDeviceNameDraft(event.target.value)}
                                    className="min-w-[180px] rounded-lg border border-accent/30 bg-abyss px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent/60"
                                  />
                                ) : (
                                  <p className="text-sm font-medium text-text-primary truncate">
                                    {device.deviceName}
                                  </p>
                                )}
                                <span className="text-xs px-2.5 py-1 rounded-lg bg-abyss text-text-secondary">
                                  {getDeviceLabel(device.deviceType)}
                                </span>
                                {isCurrentDevice && (
                                  <span className="text-xs px-2.5 py-1 rounded-lg bg-accent/10 text-accent">
                                    Bu cihaz
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-text-muted mt-1 font-[family-name:var(--font-mono)]">
                                {device.id}
                              </p>
                            </div>
                          </div>

                          <div className="grid gap-2 sm:grid-cols-2 text-xs text-text-secondary">
                            <div className="rounded-xl bg-abyss px-3 py-2">
                              Oluşturulma: {formatDateTime(device.createdAt)}
                            </div>
                            <div className="rounded-xl bg-abyss px-3 py-2">
                              Son aktivite: {formatDateTime(device.lastActive)}
                            </div>
                          </div>
                        </div>

                        <div className="shrink-0 flex flex-wrap gap-2">
                          {editingDeviceId === device.id ? (
                            <>
                              <button
                                onClick={() => handleRenameDevice(device.id)}
                                disabled={renamingDeviceId === device.id}
                                className="rounded-xl px-4 py-2 text-sm font-medium transition-all bg-accent/10 text-accent hover:bg-accent/20 disabled:opacity-40"
                              >
                                {renamingDeviceId === device.id ? "Kaydediliyor..." : "Kaydet"}
                              </button>
                              <button
                                onClick={() => {
                                  setEditingDeviceId(null);
                                  setDeviceNameDraft("");
                                }}
                                className="rounded-xl px-4 py-2 text-sm font-medium transition-all bg-surface text-text-secondary hover:text-text-primary"
                              >
                                Vazgeç
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => {
                                setEditingDeviceId(device.id);
                                setDeviceNameDraft(device.deviceName);
                              }}
                              className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all bg-surface text-text-secondary hover:text-text-primary"
                            >
                              <Pencil className="h-4 w-4" />
                              Adı Düzenle
                            </button>
                          )}

                          <button
                            onClick={() => handleRevokeDevice(device.id)}
                            disabled={isCurrentDevice || revokingDeviceId === device.id}
                            className="rounded-xl px-4 py-2 text-sm font-medium transition-all bg-danger/10 text-danger hover:bg-danger/20 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {revokingDeviceId === device.id ? "Kapatılıyor..." : "Oturumu Kapat"}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="glass rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
                <Clock className="w-5 h-5 text-accent" />
              </div>
              <div>
                <h3 className="font-semibold">Son Güvenlik Olayları</h3>
                <p className="text-sm text-text-secondary">
                  Son kimlik doğrulama ve güvenlik hareketleri
                </p>
              </div>
            </div>

            {securityLoading ? (
              <div className="py-6 flex items-center justify-center text-text-secondary">
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                Güvenlik olayları yükleniyor...
              </div>
            ) : auditEvents.length === 0 ? (
              <div className="py-6 text-center text-sm text-text-secondary bg-surface rounded-xl">
                Henüz güvenlik olayı kaydı yok.
              </div>
            ) : (
              <div className="space-y-3">
                {auditEvents.map((event) => (
                  <div
                    key={event.id}
                    className="rounded-2xl border border-border bg-surface/60 p-4"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <p className="text-sm font-medium text-text-primary">
                            {getAuditEventLabel(event)}
                          </p>
                          <span
                            className={`text-xs px-2.5 py-1 rounded-lg ${
                              event.status === "success"
                                ? "bg-accent/10 text-accent"
                                : event.status === "failure"
                                ? "bg-danger/10 text-danger"
                                : "bg-warning/10 text-warning"
                            }`}
                          >
                            {event.status === "success"
                              ? "Başarılı"
                              : event.status === "failure"
                              ? "Başarısız"
                              : "Bilgi"}
                          </span>
                          {event.deviceId && event.deviceId === currentDeviceId && (
                            <span className="text-xs px-2.5 py-1 rounded-lg bg-blue-500/10 text-blue-400">
                              Bu cihaz
                            </span>
                          )}
                        </div>

                        <p className="text-sm text-text-secondary mb-2">
                          {getAuditEventContext(event)}
                        </p>

                        <div className="flex flex-wrap gap-2 text-xs text-text-muted">
                          <span className="rounded-lg bg-abyss px-2.5 py-1">
                            {formatDateTime(event.createdAt)}
                          </span>
                          {event.ipAddress && (
                            <span className="rounded-lg bg-abyss px-2.5 py-1 font-[family-name:var(--font-mono)]">
                              IP: {event.ipAddress}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Data Tab */}
      {activeTab === "data" && (
        <div className="space-y-4 animate-fade-in">
          {/* Export */}
          <div className="glass rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
                <Download className="w-5 h-5 text-accent" />
              </div>
              <div>
                <h3 className="font-semibold">Dışa Aktar</h3>
                <p className="text-sm text-text-secondary">
                  Kasa verilerinizi farklı formatlarda dışa aktarın
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <button
                onClick={handleExportJSON}
                className="flex items-center gap-4 p-4 bg-surface rounded-xl border border-border hover:border-accent/30 transition-all group"
              >
                <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
                  <FileJson className="w-5 h-5 text-blue-400" />
                </div>
                <div className="text-left flex-1">
                  <p className="text-sm font-medium group-hover:text-accent transition-colors">
                    Şifreli JSON
                  </p>
                  <p className="text-xs text-text-muted">
                    AES-256 ile şifrelenmiş yedek
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 text-text-muted group-hover:text-accent transition-colors" />
              </button>

              <button
                onClick={handleExportCSVRequest}
                className="flex items-center gap-4 p-4 bg-surface rounded-xl border border-border hover:border-danger/30 transition-all group"
              >
                <div className="w-10 h-10 rounded-lg bg-danger/10 flex items-center justify-center shrink-0">
                  <FileSpreadsheet className="w-5 h-5 text-danger" />
                </div>
                <div className="text-left flex-1">
                  <p className="text-sm font-medium group-hover:text-danger transition-colors">
                    CSV (Düz Metin)
                  </p>
                  <p className="text-xs text-text-muted">
                    Parolaları şifrelenmeden indirir
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 text-text-muted group-hover:text-accent transition-colors" />
              </button>
            </div>

            {exportStatus && (
              <div
                className={`mt-4 flex items-center gap-2 p-3 rounded-xl text-sm ${
                  exportStatus === "success"
                    ? "bg-accent/5 border border-accent/20 text-accent"
                    : exportStatus === "empty"
                    ? "bg-warning/5 border border-warning/20 text-warning"
                    : "bg-danger/5 border border-danger/20 text-danger"
                }`}
              >
                {exportStatus === "success" ? (
                  <>
                    <Check className="w-4 h-4" />
                    Dışa aktarma başarılı
                  </>
                ) : exportStatus === "empty" ? (
                  <>
                    <AlertTriangle className="w-4 h-4" />
                    Dışa aktarılacak giriş bilgisi yok
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-4 h-4" />
                    Dışa aktarma sırasında bir hata oluştu
                  </>
                )}
              </div>
            )}
          </div>

          {/* Import */}
          <div className="glass rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
                <Upload className="w-5 h-5 text-accent" />
              </div>
              <div>
                <h3 className="font-semibold">İçe Aktar</h3>
                <p className="text-sm text-text-secondary">
                  Başka bir şifre yöneticisinden veya tarayıcıdan veri aktarın
                </p>
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.json"
              onChange={handleFileSelect}
              className="hidden"
            />

            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              className="w-full border-2 border-dashed border-border hover:border-accent/40 rounded-xl p-8 text-center transition-all group disabled:opacity-50"
            >
              {importing ? (
                <div className="flex flex-col items-center">
                  <Loader2 className="w-8 h-8 text-accent animate-spin mb-3" />
                  <p className="text-sm text-text-secondary">İçe aktarılıyor...</p>
                </div>
              ) : (
                <div className="flex flex-col items-center">
                  <Upload className="w-8 h-8 text-text-muted group-hover:text-accent transition-colors mb-3" />
                  <p className="text-sm font-medium group-hover:text-accent transition-colors mb-1">
                    CSV veya JSON dosyası seçin / sürükleyin
                  </p>
                  <p className="text-xs text-text-muted">
                    VaultMaster JSON yedekleri veya Chrome, Firefox vb. CSV formatları desteklenir
                  </p>
                </div>
              )}
            </button>

            {importStatus && (
              <div
                className={`mt-4 flex items-center gap-2 p-3 rounded-xl text-sm ${
                  importStatus.includes("başarı")
                    ? "bg-accent/5 border border-accent/20 text-accent"
                    : "bg-danger/5 border border-danger/20 text-danger"
                }`}
              >
                {importStatus.includes("başarı") ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <AlertTriangle className="w-4 h-4" />
                )}
                {importStatus === "invalid"
                  ? "Geçersiz CSV formatı. title/name, url, username, password sütunları gerekli."
                  : importStatus === "invalid_json"
                  ? "Geçersiz JSON formatı. Dosya geçerli bir VaultMaster yedeği değil."
                  : importStatus === "decrypt_error"
                  ? "Şifre çözülemedi. Yedek farklı bir ana şifre ile oluşturulmuş olabilir."
                  : importStatus === "empty"
                  ? "Dosya boş veya geçerli satır bulunamadı."
                  : importStatus === "unsupported"
                  ? "Desteklenmeyen dosya formatı. Sadece CSV veya JSON dosyaları kabul edilir."
                  : importStatus === "error"
                  ? "İçe aktarma sırasında bir hata oluştu."
                  : importStatus}
              </div>
            )}

            <div className="mt-4 bg-surface rounded-xl p-4">
              <p className="text-xs font-medium text-text-secondary mb-2">Desteklenen formatlar:</p>
              <div className="grid grid-cols-2 gap-2">
                {["VaultMaster (JSON)", "Google Chrome", "Mozilla Firefox", "Bitwarden", "LastPass"].map((name) => (
                  <div key={name} className="flex items-center gap-2 text-xs text-text-muted">
                    <Check className="w-3 h-3 text-accent" />
                    {name}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Danger Zone */}
          <div className="glass rounded-2xl p-6 border border-danger/20">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-danger/10 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-danger" />
              </div>
              <div>
                <h3 className="font-semibold text-danger">Tehlikeli Bölge</h3>
                <p className="text-sm text-text-secondary">Bu işlemler geri alınamaz</p>
              </div>
            </div>

            <div className="bg-surface rounded-xl p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Tüm Kasa Verilerini Sil</p>
                <p className="text-xs text-text-muted mt-0.5">
                  Bu işlem tüm şifrelerinizi kalıcı olarak silecektir
                </p>
              </div>
              <button
                onClick={async () => {
                  if (!tokens) return;
                  const confirmed = window.confirm(
                    "Tüm kasa verileriniz kalıcı olarak silinecek. Bu işlem geri alınamaz. Devam etmek istiyor musunuz?"
                  );
                  if (!confirmed) return;

                  const doubleConfirmed = window.confirm(
                    "Gerçekten TÜM verilerinizi silmek istediğinize emin misiniz?"
                  );
                  if (!doubleConfirmed) return;

                  const { deleteVaultItem } = useStore.getState();
                  for (const item of items) {
                    await deleteVaultItem(item.id);
                  }
                }}
                className="bg-danger/10 hover:bg-danger/20 text-danger text-sm font-medium px-4 py-2 rounded-xl transition-all shrink-0"
              >
                Tümünü Sil
              </button>
            </div>
          </div>
        </div>
      )}

      {showPlaintextCsvConfirm && (
        <PlaintextExportConfirmModal
          format="CSV"
          itemCount={loginItems.length}
          description="Login kayıtlarının başlık, URL, kullanıcı adı, parola ve not alanları düz metin olarak dışa aktarılacak."
          onConfirm={performExportCSV}
          onClose={() => setShowPlaintextCsvConfirm(false)}
        />
      )}
    </div>
  );
}
