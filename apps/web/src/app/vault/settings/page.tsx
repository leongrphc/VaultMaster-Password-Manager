"use client";

import OfflineSnapshotCleanup from "@/components/vault/OfflineSnapshotCleanup";

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
  Users,
  Trash2,
  Fingerprint,
  KeyRound,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { CsvImportError, parseVaultCsv } from "@/lib/csv-import";
import { importMasterKey, encryptJSON, decryptJSON } from "@vaultmaster/crypto";
import { api } from "@/lib/api";
import type { AuditEventResponse, DeviceResponse, EmergencyAccessGrantResponse, SharedVaultMemberResponse, VaultItemData } from "@vaultmaster/shared";
import { legacyImportSnapshot, reviewImport, type ImportReview } from "@/lib/import-conflicts";
import ImportReviewPanel from "@/components/vault/ImportReviewPanel";
import type { RestoreBackupInput } from "@vaultmaster/shared";
import TwoFactorSettings from "@/components/vault/TwoFactorSettings";
import WebAuthnSettings from "@/components/vault/WebAuthnSettings";
import AccountSecurityPanel from "@/components/vault/AccountSecurityPanel";
import SecurityNotifications from "@/components/vault/SecurityNotifications";
import FullBackupPanel from "@/components/vault/FullBackupPanel";
import PlaintextExportConfirmModal from "@/components/vault/PlaintextExportConfirmModal";
import { useShallow } from "zustand/shallow";

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
    currentDeviceId,
    runWithValidAccessToken,
    sharedVaults,
    sharedVaultMembers,
    sharedVaultItems,
    loadSharedVaults,
    createSharedVault,
    loadSharedVaultMembers,
    inviteSharedVaultMember,
    removeSharedVaultMember,
    loadSharedVaultItems,
    createSharedVaultItem,
    updateSharedVaultItem,
    deleteSharedVaultItem,
    emergencyAccessGrants,
    loadEmergencyAccessGrants,
    inviteEmergencyContact,
    acceptEmergencyAccessGrant,
    requestEmergencyAccess,
    approveEmergencyAccessRequest,
    rejectEmergencyAccessRequest,
    cancelEmergencyAccessGrant,
    releaseEmergencyAccessKey,
    getLocalUnlockStatus,
    setupLocalUnlock,
    clearLocalUnlock,
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
      currentDeviceId: state.currentDeviceId,
      runWithValidAccessToken: state.runWithValidAccessToken,
      sharedVaults: state.sharedVaults,
      sharedVaultMembers: state.sharedVaultMembers,
      sharedVaultItems: state.sharedVaultItems,
      loadSharedVaults: state.loadSharedVaults,
      createSharedVault: state.createSharedVault,
      loadSharedVaultMembers: state.loadSharedVaultMembers,
      inviteSharedVaultMember: state.inviteSharedVaultMember,
      removeSharedVaultMember: state.removeSharedVaultMember,
      loadSharedVaultItems: state.loadSharedVaultItems,
      createSharedVaultItem: state.createSharedVaultItem,
      updateSharedVaultItem: state.updateSharedVaultItem,
      deleteSharedVaultItem: state.deleteSharedVaultItem,
      emergencyAccessGrants: state.emergencyAccessGrants,
      loadEmergencyAccessGrants: state.loadEmergencyAccessGrants,
      inviteEmergencyContact: state.inviteEmergencyContact,
      acceptEmergencyAccessGrant: state.acceptEmergencyAccessGrant,
      requestEmergencyAccess: state.requestEmergencyAccess,
      approveEmergencyAccessRequest: state.approveEmergencyAccessRequest,
      rejectEmergencyAccessRequest: state.rejectEmergencyAccessRequest,
      cancelEmergencyAccessGrant: state.cancelEmergencyAccessGrant,
      releaseEmergencyAccessKey: state.releaseEmergencyAccessKey,
      getLocalUnlockStatus: state.getLocalUnlockStatus,
      setupLocalUnlock: state.setupLocalUnlock,
      clearLocalUnlock: state.clearLocalUnlock,
    }))
  );

  const [activeTab, setActiveTab] = useState<"general" | "security" | "data" | "sharing">("general");
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [showPlaintextCsvConfirm, setShowPlaintextCsvConfirm] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importReview, setImportReview] = useState<ImportReview | null>(null);
  const importGuard = useRef<(() => void) | null>(null);
  const importRequest = useRef(0);
  useEffect(() => { importRequest.current++; setImportReview(null); importGuard.current = null; }, [masterKeyBase64]);
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
  const [sharingStatus, setSharingStatus] = useState<string | null>(null);
  const [sharingError, setSharingError] = useState<string | null>(null);
  const [sharingLoading, setSharingLoading] = useState(false);
  const [selectedSharedVaultId, setSelectedSharedVaultId] = useState<string | null>(null);
  const [sharedVaultForm, setSharedVaultForm] = useState({
    encryptedMetadata: "",
    metadataIv: "",
    encryptedVaultKey: "",
    encryptedVaultKeyIv: "",
  });
  const [inviteForm, setInviteForm] = useState({
    email: "",
    role: "viewer" as "viewer" | "editor" | "admin",
    encryptedVaultKey: "",
    encryptedVaultKeyIv: "",
  });
  const [sharedVaultItemForm, setSharedVaultItemForm] = useState({
    encryptedData: "",
    iv: "",
    favorite: false,
  });
  const [editingSharedVaultItemId, setEditingSharedVaultItemId] = useState<string | null>(null);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [emergencyStatus, setEmergencyStatus] = useState<string | null>(null);
  const [emergencyError, setEmergencyError] = useState<string | null>(null);
  const [emergencyLoading, setEmergencyLoading] = useState(false);
  const [emergencyForm, setEmergencyForm] = useState({
    contactEmail: "",
    waitTimeDays: 7,
    encryptedAccessKey: "",
    encryptedAccessIv: "",
  });
  const [releasedEmergencyKey, setReleasedEmergencyKey] = useState<EmergencyAccessGrantResponse | null>(null);
  const [localUnlockStatus, setLocalUnlockStatus] = useState(() => getLocalUnlockStatus());
  const [localUnlockLoading, setLocalUnlockLoading] = useState(false);
  const [localUnlockMessage, setLocalUnlockMessage] = useState<string | null>(null);
  const [localUnlockError, setLocalUnlockError] = useState<string | null>(null);
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

    const guard = useStore.getState().getVaultOperationGuard();
    try {
      await runWithValidAccessToken(token => api.auth.authorizeExport(token));
      guard();
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

      guard();
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

  const performExportCSV = async () => {
    const guard = useStore.getState().getVaultOperationGuard();
    try { await runWithValidAccessToken(token => api.auth.authorizeExport(token)); guard(); }
    catch { setShowPlaintextCsvConfirm(false); setExportStatus("error"); return; }
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

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const requestId = ++importRequest.current;
    setImporting(true); setImportStatus(null); setImportReview(null);
    const guard = useStore.getState().getVaultOperationGuard();
    const assertCurrent = () => { guard(); if (importRequest.current !== requestId) throw new Error("Import cancelled"); };
    try {
      if (file.size > 24 * 1024 * 1024) throw new Error("Import limit");
      const text = await file.text(); assertCurrent();
      let payload: unknown;
      if (file.name.toLowerCase().endsWith(".csv")) {
        const result = parseVaultCsv(text);
        const folderIds = new Map<string, string>();
        for (const record of result.records) if (record.folderName && !folderIds.has(record.folderName)) folderIds.set(record.folderName, crypto.randomUUID());
        payload = { folders: [...folderIds].map(([name, id]) => ({ id, name })),
          items: result.records.map(record => ({ data: record.data, folderId: folderIds.get(record.folderName) ?? null, favorite: record.favorite })) };
        if (result.skipped || result.ignoredColumns) setImportStatus(`${result.skipped} desteklenmeyen/boş satır ve ${result.ignoredColumns} desteklenmeyen sütun atlandı. Yalnızca desteklenen içerik içe aktarılacak; onaydan önce kontrol edin.`);
      } else if (file.name.toLowerCase().endsWith(".json")) {
        const parsed = JSON.parse(text);
        if (parsed.encrypted !== true || typeof parsed.ciphertext !== "string" || typeof parsed.iv !== "string") throw new Error("Invalid import");
        payload = await decryptJSON(parsed.ciphertext, parsed.iv, await importMasterKey(masterKeyBase64!));
      } else throw new Error("Unsupported import");
      assertCurrent();
      const snapshot = await legacyImportSnapshot(payload, masterKeyBase64!, assertCurrent);
      const current = await runWithValidAccessToken(token => { assertCurrent(); return api.backups.importState(token); });
      const review = await reviewImport({ backupId: crypto.randomUUID(), snapshot }, current.data, masterKeyBase64!, assertCurrent);
      assertCurrent(); importGuard.current = assertCurrent; setImportReview(review);
    } catch (failure) {
      if (requestId === importRequest.current) setImportStatus(failure instanceof CsvImportError ? failure.code : "error");
    } finally { if (requestId === importRequest.current) setImporting(false); }
  };
  const commitImport = async (body: RestoreBackupInput) => {
    const guard = importGuard.current;
    if (!guard) throw new Error("Import cancelled");
    guard(); setImporting(true);
    try {
      await runWithValidAccessToken(token => { guard(); return api.backups.restore(body, token, guard); });
      guard();
      setImportReview(null); importGuard.current = null;
      setImportStatus(`${body.snapshot.items.length} öğe başarıyla içe aktarıldı`);
      await useStore.getState().loadVault();
    } finally { setImporting(false); }
  };

  const handleSetupLocalUnlock = async () => {
    setLocalUnlockLoading(true);
    setLocalUnlockMessage(null);
    setLocalUnlockError(null);

    try {
      const status = await setupLocalUnlock();
      setLocalUnlockStatus(status);
      setLocalUnlockMessage("Yerel kilit açma bu cihaz için etkinleştirildi");
    } catch (error) {
      setLocalUnlockError(error instanceof Error ? error.message : "Yerel kilit açma ayarlanamadı");
    } finally {
      setLocalUnlockLoading(false);
    }
  };

  const handleClearLocalUnlock = () => {
    clearLocalUnlock();
    setLocalUnlockStatus(getLocalUnlockStatus());
    setLocalUnlockMessage("Yerel kilit açma bu cihazdan kaldırıldı");
    setLocalUnlockError(null);
  };

  const tabs = [
    { id: "general" as const, label: "Genel", icon: Settings },
    { id: "security" as const, label: "Güvenlik", icon: Shield },
    { id: "data" as const, label: "Veri Yönetimi", icon: Download },
    { id: "sharing" as const, label: "Paylaşım", icon: Users },
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

  useEffect(() => {
    if (activeTab !== "sharing" || !tokens) {
      return;
    }

    setSharingLoading(true);
    setSharingError(null);
    loadSharedVaults()
      .catch((error) => {
        console.error("Paylaşımlı kasalar yüklenemedi:", error);
        setSharingError(error instanceof Error ? error.message : "Paylaşımlı kasalar yüklenemedi");
      })
      .finally(() => setSharingLoading(false));

    loadEmergencyAccessGrants().catch((error) => {
      console.error("Acil durum erişimleri yüklenemedi:", error);
      setEmergencyError(error instanceof Error ? error.message : "Acil durum erişimleri yüklenemedi");
    });
  }, [activeTab, tokens, loadSharedVaults, loadEmergencyAccessGrants]);

  const selectedSharedVault = sharedVaults.find((vault) => vault.id === selectedSharedVaultId) ?? null;
  const selectedMembers = selectedSharedVaultId
    ? sharedVaultMembers[selectedSharedVaultId] ?? []
    : [];
  const selectedSharedVaultItems = selectedSharedVaultId
    ? sharedVaultItems[selectedSharedVaultId] ?? []
    : [];
  const selectedSharedVaultRole = selectedSharedVault?.currentUserMembership?.role ?? "owner";
  const canWriteSelectedSharedVault = ["owner", "admin", "editor"].includes(selectedSharedVaultRole);

  const handleCreateSharedVault = async () => {
    setSharingError(null);
    setSharingStatus(null);
    if (
      !sharedVaultForm.encryptedMetadata.trim() ||
      !sharedVaultForm.metadataIv.trim() ||
      !sharedVaultForm.encryptedVaultKey.trim() ||
      !sharedVaultForm.encryptedVaultKeyIv.trim()
    ) {
      setSharingError("Tüm şifreli alanlar gereklidir");
      return;
    }

    setSharingLoading(true);
    try {
      const created = await createSharedVault({
        encryptedMetadata: sharedVaultForm.encryptedMetadata.trim(),
        metadataIv: sharedVaultForm.metadataIv.trim(),
        encryptedVaultKey: sharedVaultForm.encryptedVaultKey.trim(),
        encryptedVaultKeyIv: sharedVaultForm.encryptedVaultKeyIv.trim(),
      });
      setSelectedSharedVaultId(created.id);
      setSharedVaultForm({ encryptedMetadata: "", metadataIv: "", encryptedVaultKey: "", encryptedVaultKeyIv: "" });
      setSharingStatus("Paylaşımlı kasa kaydı oluşturuldu");
    } catch (error) {
      console.error("Paylaşımlı kasa oluşturulamadı:", error);
      setSharingError(error instanceof Error ? error.message : "Paylaşımlı kasa oluşturulamadı");
    } finally {
      setSharingLoading(false);
    }
  };

  const handleLoadSharedVaultMembers = async (sharedVaultId: string) => {
    setSelectedSharedVaultId(sharedVaultId);
    setSharingError(null);
    try {
      await Promise.all([
        loadSharedVaultMembers(sharedVaultId),
        loadSharedVaultItems(sharedVaultId),
      ]);
    } catch (error) {
      console.error("Üyeler yüklenemedi:", error);
      setSharingError(error instanceof Error ? error.message : "Üyeler yüklenemedi");
    }
  };

  const handleInviteSharedVaultMember = async () => {
    if (!selectedSharedVaultId) {
      setSharingError("Önce bir paylaşımlı kasa seçin");
      return;
    }

    setSharingError(null);
    setSharingStatus(null);
    if (
      !inviteForm.email.trim() ||
      !inviteForm.encryptedVaultKey.trim() ||
      !inviteForm.encryptedVaultKeyIv.trim()
    ) {
      setSharingError("E-posta ve şifreli anahtar alanları gereklidir");
      return;
    }

    setSharingLoading(true);
    try {
      await inviteSharedVaultMember(selectedSharedVaultId, {
        email: inviteForm.email.trim(),
        role: inviteForm.role,
        encryptedVaultKey: inviteForm.encryptedVaultKey.trim(),
        encryptedVaultKeyIv: inviteForm.encryptedVaultKeyIv.trim(),
      });
      setInviteForm({ email: "", role: "viewer", encryptedVaultKey: "", encryptedVaultKeyIv: "" });
      setSharingStatus("Üye şifreli anahtar materyaliyle davet edildi");
    } catch (error) {
      console.error("Üye davet edilemedi:", error);
      setSharingError(error instanceof Error ? error.message : "Üye davet edilemedi");
    } finally {
      setSharingLoading(false);
    }
  };

  const handleRemoveSharedVaultMember = async (member: SharedVaultMemberResponse) => {
    if (!selectedSharedVaultId) {
      return;
    }

    const confirmed = window.confirm("Bu üyeyi paylaşımlı kasadan kaldırmak istiyor musunuz?");
    if (!confirmed) {
      return;
    }

    setRemovingMemberId(member.id);
    setSharingError(null);
    setSharingStatus(null);
    try {
      await removeSharedVaultMember(selectedSharedVaultId, member.id);
      setSharingStatus("Üye kaldırıldı");
    } catch (error) {
      console.error("Üye kaldırılamadı:", error);
      setSharingError(error instanceof Error ? error.message : "Üye kaldırılamadı");
    } finally {
      setRemovingMemberId(null);
    }
  };

  const handleSaveSharedVaultItem = async () => {
    if (!selectedSharedVaultId) {
      setSharingError("Önce bir paylaşımlı kasa seçin");
      return;
    }

    if (!sharedVaultItemForm.encryptedData.trim() || !sharedVaultItemForm.iv.trim()) {
      setSharingError("Şifreli öğe verisi ve IV gereklidir");
      return;
    }

    setSharingError(null);
    setSharingStatus(null);
    setSharingLoading(true);
    try {
      const body = {
        encryptedData: sharedVaultItemForm.encryptedData.trim(),
        iv: sharedVaultItemForm.iv.trim(),
        favorite: sharedVaultItemForm.favorite,
      };

      if (editingSharedVaultItemId) {
        await updateSharedVaultItem(selectedSharedVaultId, editingSharedVaultItemId, body);
        setSharingStatus("Şifreli paylaşımlı kasa öğesi güncellendi");
      } else {
        await createSharedVaultItem(selectedSharedVaultId, body);
        setSharingStatus("Şifreli paylaşımlı kasa öğesi eklendi");
      }

      setSharedVaultItemForm({ encryptedData: "", iv: "", favorite: false });
      setEditingSharedVaultItemId(null);
    } catch (error) {
      console.error("Paylaşımlı kasa öğesi kaydedilemedi:", error);
      setSharingError(error instanceof Error ? error.message : "Paylaşımlı kasa öğesi kaydedilemedi");
    } finally {
      setSharingLoading(false);
    }
  };

  const handleEditSharedVaultItem = (item: { id: string; encryptedData: string; iv: string; favorite: boolean }) => {
    setEditingSharedVaultItemId(item.id);
    setSharedVaultItemForm({ encryptedData: item.encryptedData, iv: item.iv, favorite: item.favorite });
  };

  const handleDeleteSharedVaultItem = async (itemId: string) => {
    if (!selectedSharedVaultId) {
      return;
    }

    const confirmed = window.confirm("Bu paylaşımlı kasa öğesini silmek istiyor musunuz?");
    if (!confirmed) {
      return;
    }

    setSharingError(null);
    setSharingStatus(null);
    try {
      await deleteSharedVaultItem(selectedSharedVaultId, itemId);
      setSharingStatus("Paylaşımlı kasa öğesi silindi");
    } catch (error) {
      console.error("Paylaşımlı kasa öğesi silinemedi:", error);
      setSharingError(error instanceof Error ? error.message : "Paylaşımlı kasa öğesi silinemedi");
    }
  };

  const runEmergencyAction = async (action: () => Promise<void>, successMessage: string) => {
    setEmergencyLoading(true);
    setEmergencyError(null);
    setEmergencyStatus(null);
    setReleasedEmergencyKey(null);
    try {
      await action();
      setEmergencyStatus(successMessage);
    } catch (error) {
      console.error("Acil durum erişimi işlemi başarısız:", error);
      setEmergencyError(error instanceof Error ? error.message : "Acil durum erişimi işlemi başarısız");
    } finally {
      setEmergencyLoading(false);
    }
  };

  const handleInviteEmergencyContact = async () => {
    if (
      !emergencyForm.contactEmail.trim() ||
      !emergencyForm.encryptedAccessKey.trim() ||
      !emergencyForm.encryptedAccessIv.trim()
    ) {
      setEmergencyError("E-posta ve şifreli erişim anahtarı alanları gereklidir");
      return;
    }

    await runEmergencyAction(async () => {
      await inviteEmergencyContact({
        contactEmail: emergencyForm.contactEmail.trim(),
        encryptedAccessKey: emergencyForm.encryptedAccessKey.trim(),
        encryptedAccessIv: emergencyForm.encryptedAccessIv.trim(),
        waitTimeDays: emergencyForm.waitTimeDays,
      });
      setEmergencyForm({ contactEmail: "", waitTimeDays: 7, encryptedAccessKey: "", encryptedAccessIv: "" });
    }, "Acil durum kişisi davet edildi");
  };

  const handleReleaseEmergencyAccessKey = async (id: string) => {
    await runEmergencyAction(async () => {
      const released = await releaseEmergencyAccessKey(id);
      setReleasedEmergencyKey(released);
    }, "Şifreli erişim anahtarı alındı");
  };

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
      "auth.login.webauthn": "WebAuthn ile giriş yapıldı",
      "auth.logout": "Çıkış yapıldı",
      "auth.refresh": "Oturum yenilendi",
      "security.2fa.setup": "2FA kurulumu başlatıldı",
      "security.2fa.enable": "2FA etkinleştirildi",
      "security.2fa.disable": "2FA devre dışı bırakıldı",
      "security.2fa.recovery_codes.regenerate": "Recovery codes yenilendi",
      "security.webauthn.register": "WebAuthn anahtarı eklendi",
      "security.webauthn.rename": "WebAuthn anahtarı yeniden adlandırıldı",
      "security.webauthn.remove": "WebAuthn anahtarı kaldırıldı",
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

          <OfflineSnapshotCleanup />

          <div className="glass rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
                <Puzzle className="w-5 h-5 text-accent" />
              </div>
              <div>
                <h3 className="font-semibold">Tarayıcı Eklentisi</h3>
                <p className="text-sm text-text-secondary">
                  Web sekmesi açık olmadan kasanın kilidini açın ve eşleşen giriş bilgisini onayla doldurun.
                </p>
              </div>
            </div>

            <div className="space-y-2 text-sm text-text-secondary">
              <a href="/downloads/vaultmaster-extension.zip" download className="inline-flex px-4 py-2 rounded-xl bg-accent text-midnight font-semibold">Chrome / Edge Eklentisini İndir</a>
              <p>Manuel kurulum adayı; mağaza yayını veya otomatik güncelleme doğrulanmış değildir. Chrome 127+ gerekir; Edge sürümü ayrıca elle doğrulanmalıdır.</p>
              <a href="/downloads/vaultmaster-extension.zip.sha256" download className="underline">ZIP SHA-256 Sağlamasını İndir</a>
              <p>1. ZIP sağlamasını doğrulayın ve dosyayı güncellemelerde de kullanacağınız sabit bir klasöre çıkarın.</p>
              <p>2. Chrome&apos;da chrome://extensions, Edge&apos;de edge://extensions sayfasında geliştirici modunu açıp “Paketlenmemiş öğe yükle” ile bu klasörü seçin.</p>
              <p>3. Tarayıcıdaki VaultMaster simgesinden e-posta, ana şifre ve yapılandırılmış ikinci faktörle giriş yapın.</p>
              <p>4. Hedef kökeni kontrol edip eşleşen giriş bilgisini seçerek doldurmayı onaylayın. Kasa, giriş/kilit açmadan 5 dakika sonra ve cihaz kilitlenince kilitlenir.</p>
              <p>5. Güncellemede aynı klasördeki dosyaları değiştirip eklentiyi yeniden yükleyin; kimliği/sürümü kontrol edip tekrar giriş yapın. Eklentiyi kaldırmak yerel tercihleri silebilir.</p>
              <p>API bağlantısı gerekir. Farklı kökenli iframe ve kapalı Shadow DOM desteklenmez; HTTPS giriş bilgileri HTTP sayfaya doldurulmaz.</p>
              <a href="https://github.com/leongrphc/VaultMaster-Password-Manager/blob/feature/p1-6-extension-docs-terminology/apps/extension/README.md" target="_blank" rel="noopener noreferrer" className="underline">Eklenti Kurulum ve Kullanım Rehberi</a>
              <a href="https://github.com/leongrphc/VaultMaster-Password-Manager/blob/feature/p1-6-extension-docs-terminology/docs/TERMINOLOGY.md" target="_blank" rel="noopener noreferrer" className="ml-3 underline">Terimler Sözlüğü</a>
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
          <WebAuthnSettings />
          <SecurityNotifications />
          <AccountSecurityPanel />

          <div className="glass rounded-2xl p-6">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
                  <Fingerprint className="w-5 h-5 text-accent" />
                </div>
                <div>
                  <h3 className="font-semibold">Yerel Platform Doğrulayıcı</h3>
                  <p className="text-sm text-text-secondary">
                    Windows Hello, Touch ID veya cihaz biyometrisi ile yalnızca bu cihazda kilit açma
                  </p>
                </div>
              </div>
              <span className={`text-xs px-2.5 py-1 rounded-lg font-medium ${
                localUnlockStatus.enabled ? "bg-accent/10 text-accent" : "bg-warning/10 text-warning"
              }`}>
                {localUnlockStatus.enabled ? "Etkin" : "Kapalı"}
              </span>
            </div>

            <div className="rounded-xl border border-border bg-surface/60 p-4 text-sm text-text-secondary space-y-2">
              <div className="flex items-start gap-2">
                <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                <p>
                  Kurulum, master key&apos;i WebAuthn PRF ile üretilen cihaz-yerel bir anahtarla localStorage içinde şifreler. Master şifre, master key ve biyometrik sır sunucuya gönderilmez.
                </p>
              </div>
              <p className="text-xs text-text-muted">
                Ana şifre fallback&apos;i her zaman zorunludur; cihaz veya tarayıcı desteği kaybolursa ana şifre ile açmaya devam edebilirsiniz.
              </p>
              {localUnlockStatus.createdAt && (
                <p className="text-xs text-text-muted">
                  Kurulum zamanı: {formatDateTime(localUnlockStatus.createdAt)}
                </p>
              )}
            </div>

            {localUnlockMessage && (
              <div className="mt-4 flex items-center gap-2 p-3 rounded-xl bg-accent/5 border border-accent/20 text-accent text-sm">
                <Check className="w-4 h-4" />
                {localUnlockMessage}
              </div>
            )}

            {localUnlockError && (
              <div className="mt-4 flex items-center gap-2 p-3 rounded-xl bg-danger/5 border border-danger/20 text-danger text-sm">
                <AlertTriangle className="w-4 h-4" />
                {localUnlockError}
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={handleSetupLocalUnlock}
                disabled={localUnlockLoading || !masterKeyBase64 || !userEmail}
                className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-midnight hover:bg-accent-dim disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {localUnlockLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Fingerprint className="w-4 h-4" />}
                {localUnlockStatus.enabled ? "Yeniden Kur" : "Bu Cihazda Etkinleştir"}
              </button>
              <button
                onClick={handleClearLocalUnlock}
                disabled={!localUnlockStatus.enabled || localUnlockLoading}
                className="inline-flex items-center gap-2 rounded-xl bg-surface px-4 py-2 text-sm font-medium text-text-secondary hover:text-danger disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Trash2 className="w-4 h-4" />
                Kaldır
              </button>
            </div>
          </div>

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
          <FullBackupPanel />
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
                    Yalnızca aktif öğeler; mevcut kasaya bağımlı
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
                    Şifreleri şifrelenmeden indirir
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
              disabled={importing}
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
                    CSV veya JSON dosyası seçin
                  </p>
                  <p className="text-xs text-text-muted">
                    VaultMaster JSON yedekleri veya yaygın tarayıcı/şifre yöneticisi CSV formatları desteklenir
                  </p>
                </div>
              )}
            </button>

            {importReview && <ImportReviewPanel key={importReview.body.backupId} review={importReview} busy={importing} commit={commitImport} cancel={() => { importRequest.current++; setImportReview(null); importGuard.current = null; setImportStatus(null); }} />}
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
                  ? "Geçersiz CSV formatı. VaultMaster, Chrome, Firefox, Bitwarden, 1Password, Dashlane veya LastPass şablonlarından biri gerekli."
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
                {["VaultMaster (JSON/CSV)", "Google Chrome", "Mozilla Firefox", "Bitwarden", "1Password", "Dashlane", "LastPass"].map((name) => (
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

      {activeTab === "sharing" && (
        <div className="space-y-4 animate-fade-in">
          <div className="glass rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
                <Users className="w-5 h-5 text-accent" />
              </div>
              <div>
                <h3 className="font-semibold">Paylaşımlı Kasa Temeli</h3>
                <p className="text-sm text-text-secondary">
                  Sunucu yalnızca şifreli metadata ve alıcıya sarılmış kasa anahtarlarını saklar.
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-warning/20 bg-warning/5 p-4 text-sm text-warning/90 mb-5">
              Bu ilk sürüm anahtar üretmez veya düz metin anahtar kabul etmez. Metadata ve vault key istemcide şifrelenmiş/sarılmış olarak hazırlanıp buraya yapıştırılmalıdır.
            </div>

            {(sharingError || sharingStatus) && (
              <div className={`mb-4 flex items-center gap-2 p-3 rounded-xl text-sm ${sharingError ? "bg-danger/5 border border-danger/20 text-danger" : "bg-accent/5 border border-accent/20 text-accent"}`}>
                {sharingError ? <AlertTriangle className="w-4 h-4" /> : <Check className="w-4 h-4" />}
                {sharingError ?? sharingStatus}
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <input value={sharedVaultForm.encryptedMetadata} onChange={(event) => setSharedVaultForm((form) => ({ ...form, encryptedMetadata: event.target.value }))} placeholder="encryptedMetadata" className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-text-primary outline-none focus:border-accent/60" />
              <input value={sharedVaultForm.metadataIv} onChange={(event) => setSharedVaultForm((form) => ({ ...form, metadataIv: event.target.value }))} placeholder="metadataIv" className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-text-primary outline-none focus:border-accent/60" />
              <input value={sharedVaultForm.encryptedVaultKey} onChange={(event) => setSharedVaultForm((form) => ({ ...form, encryptedVaultKey: event.target.value }))} placeholder="owner encryptedVaultKey" className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-text-primary outline-none focus:border-accent/60" />
              <input value={sharedVaultForm.encryptedVaultKeyIv} onChange={(event) => setSharedVaultForm((form) => ({ ...form, encryptedVaultKeyIv: event.target.value }))} placeholder="owner encryptedVaultKeyIv" className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-text-primary outline-none focus:border-accent/60" />
            </div>

            <button onClick={handleCreateSharedVault} disabled={sharingLoading} className="mt-4 rounded-xl bg-accent/10 px-4 py-2 text-sm font-medium text-accent hover:bg-accent/20 disabled:opacity-50">
              {sharingLoading ? "Kaydediliyor..." : "Paylaşımlı Kasa Kaydı Oluştur"}
            </button>
          </div>

          <div className="glass rounded-2xl p-6">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="font-semibold">Kasalar ve Üyeler</h3>
                <p className="text-sm text-text-secondary">Davet ve üye yönetimi şifreli key wrapping alanlarıyla yapılır.</p>
              </div>
              <button onClick={() => void loadSharedVaults()} className="rounded-xl bg-surface px-3 py-2 text-sm text-text-secondary hover:text-text-primary">Yenile</button>
            </div>

            {sharingLoading && sharedVaults.length === 0 ? (
              <div className="py-8 text-center text-sm text-text-secondary bg-surface rounded-xl">Yükleniyor...</div>
            ) : sharedVaults.length === 0 ? (
              <div className="py-8 text-center text-sm text-text-secondary bg-surface rounded-xl">Henüz paylaşımlı kasa yok.</div>
            ) : (
              <div className="space-y-3">
                {sharedVaults.map((vault) => (
                  <button key={vault.id} onClick={() => void handleLoadSharedVaultMembers(vault.id)} className={`w-full rounded-2xl border p-4 text-left transition-all ${selectedSharedVaultId === vault.id ? "border-accent/40 bg-accent/5" : "border-border bg-surface/60 hover:border-accent/20"}`}>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="truncate font-[family-name:var(--font-mono)] text-xs text-text-primary">{vault.id}</p>
                        <p className="mt-1 text-xs text-text-muted">Owner: {vault.ownerId}</p>
                      </div>
                      <span className="rounded-lg bg-abyss px-2.5 py-1 text-xs text-accent">{vault.currentUserMembership?.role ?? "owner"}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedSharedVault && (
            <div className="glass rounded-2xl p-6">
              <h3 className="font-semibold mb-4">Seçili Kasa Üyeleri</h3>
              <div className="grid gap-3 sm:grid-cols-2 mb-4">
                <input value={inviteForm.email} onChange={(event) => setInviteForm((form) => ({ ...form, email: event.target.value }))} placeholder="Üye e-postası" className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-text-primary outline-none focus:border-accent/60" />
                <select value={inviteForm.role} onChange={(event) => setInviteForm((form) => ({ ...form, role: event.target.value as "viewer" | "editor" | "admin" }))} className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-text-primary outline-none focus:border-accent/60">
                  <option value="viewer">viewer</option>
                  <option value="editor">editor</option>
                  <option value="admin">admin</option>
                </select>
                <input value={inviteForm.encryptedVaultKey} onChange={(event) => setInviteForm((form) => ({ ...form, encryptedVaultKey: event.target.value }))} placeholder="recipient encryptedVaultKey" className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-text-primary outline-none focus:border-accent/60" />
                <input value={inviteForm.encryptedVaultKeyIv} onChange={(event) => setInviteForm((form) => ({ ...form, encryptedVaultKeyIv: event.target.value }))} placeholder="recipient encryptedVaultKeyIv" className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-text-primary outline-none focus:border-accent/60" />
              </div>
              <button onClick={handleInviteSharedVaultMember} disabled={sharingLoading} className="mb-5 rounded-xl bg-accent/10 px-4 py-2 text-sm font-medium text-accent hover:bg-accent/20 disabled:opacity-50">Üye Davet Et</button>

              <div className="space-y-3">
                {selectedMembers.length === 0 ? (
                  <div className="py-6 text-center text-sm text-text-secondary bg-surface rounded-xl">Üyeler yüklenmedi veya bulunamadı.</div>
                ) : selectedMembers.map((member) => (
                  <div key={member.id} className="rounded-2xl border border-border bg-surface/60 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-text-primary">{member.email ?? member.userId}</p>
                        <p className="mt-1 truncate font-[family-name:var(--font-mono)] text-xs text-text-muted">{member.encryptedVaultKey}</p>
                        <div className="mt-2 flex gap-2 text-xs"><span className="rounded-lg bg-abyss px-2.5 py-1 text-accent">{member.role}</span><span className="rounded-lg bg-abyss px-2.5 py-1 text-text-secondary">{member.status}</span></div>
                      </div>
                      <button onClick={() => void handleRemoveSharedVaultMember(member)} disabled={removingMemberId === member.id || member.role === "owner"} className="inline-flex items-center gap-2 rounded-xl bg-danger/10 px-4 py-2 text-sm font-medium text-danger hover:bg-danger/20 disabled:opacity-40">
                        <Trash2 className="h-4 w-4" />
                        {removingMemberId === member.id ? "Kaldırılıyor..." : "Kaldır"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {selectedSharedVault && (
            <div className="glass rounded-2xl p-6">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <h3 className="font-semibold">Şifreli Paylaşımlı Kasa Öğeleri</h3>
                  <p className="text-sm text-text-secondary">Sunucu yalnızca encryptedData ve iv alanlarını saklar; öğe içeriği istemcide şifrelenmiş olmalıdır.</p>
                </div>
                <button onClick={() => void loadSharedVaultItems(selectedSharedVault.id)} className="rounded-xl bg-surface px-3 py-2 text-sm text-text-secondary hover:text-text-primary">Öğeleri Yenile</button>
              </div>

              {canWriteSelectedSharedVault ? (
                <div className="mb-5 rounded-2xl border border-border bg-surface/60 p-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input value={sharedVaultItemForm.encryptedData} onChange={(event) => setSharedVaultItemForm((form) => ({ ...form, encryptedData: event.target.value }))} placeholder="encryptedData" className="rounded-xl border border-border bg-abyss px-4 py-3 text-sm text-text-primary outline-none focus:border-accent/60" />
                    <input value={sharedVaultItemForm.iv} onChange={(event) => setSharedVaultItemForm((form) => ({ ...form, iv: event.target.value }))} placeholder="iv" className="rounded-xl border border-border bg-abyss px-4 py-3 text-sm text-text-primary outline-none focus:border-accent/60" />
                  </div>
                  <label className="mt-3 flex items-center gap-2 text-sm text-text-secondary">
                    <input type="checkbox" checked={sharedVaultItemForm.favorite} onChange={(event) => setSharedVaultItemForm((form) => ({ ...form, favorite: event.target.checked }))} className="h-4 w-4 accent-accent" />
                    Favori
                  </label>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button onClick={handleSaveSharedVaultItem} disabled={sharingLoading} className="rounded-xl bg-accent/10 px-4 py-2 text-sm font-medium text-accent hover:bg-accent/20 disabled:opacity-50">
                      {editingSharedVaultItemId ? "Şifreli Öğeyi Güncelle" : "Şifreli Öğe Ekle"}
                    </button>
                    {editingSharedVaultItemId && (
                      <button onClick={() => { setEditingSharedVaultItemId(null); setSharedVaultItemForm({ encryptedData: "", iv: "", favorite: false }); }} className="rounded-xl bg-surface px-4 py-2 text-sm font-medium text-text-secondary hover:text-text-primary">
                        Vazgeç
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="mb-5 rounded-xl border border-warning/20 bg-warning/5 p-4 text-sm text-warning/90">
                  Viewer rolü paylaşımlı kasa öğelerini listeleyebilir, ancak oluşturamaz, güncelleyemez veya silemez.
                </div>
              )}

              <div className="space-y-3">
                {selectedSharedVaultItems.length === 0 ? (
                  <div className="py-6 text-center text-sm text-text-secondary bg-surface rounded-xl">Paylaşımlı kasa öğesi yok veya henüz yüklenmedi.</div>
                ) : selectedSharedVaultItems.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-border bg-surface/60 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="truncate font-[family-name:var(--font-mono)] text-xs text-text-primary">{item.id}</p>
                        <p className="mt-1 truncate font-[family-name:var(--font-mono)] text-xs text-text-muted">{item.encryptedData}</p>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs">
                          <span className="rounded-lg bg-abyss px-2.5 py-1 text-text-secondary">IV: {item.iv}</span>
                          <span className="rounded-lg bg-abyss px-2.5 py-1 text-accent">{item.favorite ? "favorite" : "normal"}</span>
                          <span className="rounded-lg bg-abyss px-2.5 py-1 text-text-secondary">{formatDateTime(item.updatedAt)}</span>
                        </div>
                      </div>
                      {canWriteSelectedSharedVault && (
                        <div className="flex shrink-0 flex-wrap gap-2">
                          <button onClick={() => handleEditSharedVaultItem(item)} className="rounded-xl bg-accent/10 px-4 py-2 text-sm font-medium text-accent hover:bg-accent/20">Düzenle</button>
                          <button onClick={() => void handleDeleteSharedVaultItem(item.id)} className="rounded-xl bg-danger/10 px-4 py-2 text-sm font-medium text-danger hover:bg-danger/20">Sil</button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="glass rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
                <Shield className="w-5 h-5 text-accent" />
              </div>
              <div>
                <h3 className="font-semibold">Acil Durum Erişimi</h3>
                <p className="text-sm text-text-secondary">
                  Trusted contact daveti, bekleme süresi ve encrypted key release akışı.
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-warning/20 bg-warning/5 p-4 text-sm text-warning/90 mb-5">
              Recovery/share key materyali istemcide contact için şifrelenmiş olarak hazırlanmalıdır; sunucu yalnızca encryptedAccessKey ve IV saklar.
            </div>

            {(emergencyError || emergencyStatus) && (
              <div className={`mb-4 flex items-center gap-2 p-3 rounded-xl text-sm ${emergencyError ? "bg-danger/5 border border-danger/20 text-danger" : "bg-accent/5 border border-accent/20 text-accent"}`}>
                {emergencyError ? <AlertTriangle className="w-4 h-4" /> : <Check className="w-4 h-4" />}
                {emergencyError ?? emergencyStatus}
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <input value={emergencyForm.contactEmail} onChange={(event) => setEmergencyForm((form) => ({ ...form, contactEmail: event.target.value }))} placeholder="Contact e-postası" className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-text-primary outline-none focus:border-accent/60" />
              <input type="number" min={1} max={30} value={emergencyForm.waitTimeDays} onChange={(event) => setEmergencyForm((form) => ({ ...form, waitTimeDays: Number(event.target.value) }))} placeholder="Bekleme günü" className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-text-primary outline-none focus:border-accent/60" />
              <input value={emergencyForm.encryptedAccessKey} onChange={(event) => setEmergencyForm((form) => ({ ...form, encryptedAccessKey: event.target.value }))} placeholder="contact encryptedAccessKey" className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-text-primary outline-none focus:border-accent/60" />
              <input value={emergencyForm.encryptedAccessIv} onChange={(event) => setEmergencyForm((form) => ({ ...form, encryptedAccessIv: event.target.value }))} placeholder="contact encryptedAccessIv" className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-text-primary outline-none focus:border-accent/60" />
            </div>

            <button onClick={handleInviteEmergencyContact} disabled={emergencyLoading} className="mt-4 rounded-xl bg-accent/10 px-4 py-2 text-sm font-medium text-accent hover:bg-accent/20 disabled:opacity-50">
              {emergencyLoading ? "İşleniyor..." : "Acil Durum Kişisi Davet Et"}
            </button>

            {releasedEmergencyKey?.encryptedAccessKey && (
              <div className="mt-5 rounded-2xl border border-accent/20 bg-accent/5 p-4">
                <p className="text-sm font-medium text-accent mb-2">Released encrypted key</p>
                <p className="break-all font-[family-name:var(--font-mono)] text-xs text-text-primary">{releasedEmergencyKey.encryptedAccessKey}</p>
                <p className="mt-2 break-all font-[family-name:var(--font-mono)] text-xs text-text-muted">IV: {releasedEmergencyKey.encryptedAccessIv}</p>
              </div>
            )}

            <div className="mt-6 space-y-3">
              {emergencyAccessGrants.length === 0 ? (
                <div className="py-8 text-center text-sm text-text-secondary bg-surface rounded-xl">Henüz acil durum erişimi yok.</div>
              ) : emergencyAccessGrants.map((grant) => (
                <div key={grant.id} className="rounded-2xl border border-border bg-surface/60 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-text-primary">{grant.contactEmail ?? grant.ownerEmail ?? grant.contactId}</p>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        <span className="rounded-lg bg-abyss px-2.5 py-1 text-accent">{grant.status}</span>
                        <span className="rounded-lg bg-abyss px-2.5 py-1 text-text-secondary">{grant.waitTimeDays} gün</span>
                        {grant.availableAt && <span className="rounded-lg bg-abyss px-2.5 py-1 text-text-secondary">Release: {formatDateTime(grant.availableAt)}</span>}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {grant.status === "pending" && <button onClick={() => void runEmergencyAction(() => acceptEmergencyAccessGrant(grant.id), "Davet kabul edildi")} disabled={emergencyLoading} className="rounded-xl bg-accent/10 px-3 py-2 text-xs font-medium text-accent hover:bg-accent/20 disabled:opacity-50">Kabul et</button>}
                      {grant.status === "active" && <button onClick={() => void runEmergencyAction(() => requestEmergencyAccess(grant.id), "Erişim talep edildi")} disabled={emergencyLoading} className="rounded-xl bg-warning/10 px-3 py-2 text-xs font-medium text-warning hover:bg-warning/20 disabled:opacity-50">Talep et</button>}
                      {grant.status === "requested" && <button onClick={() => void runEmergencyAction(() => approveEmergencyAccessRequest(grant.id), "Talep onaylandı")} disabled={emergencyLoading} className="rounded-xl bg-accent/10 px-3 py-2 text-xs font-medium text-accent hover:bg-accent/20 disabled:opacity-50">Onayla</button>}
                      {grant.status === "requested" && <button onClick={() => void runEmergencyAction(() => rejectEmergencyAccessRequest(grant.id), "Talep reddedildi")} disabled={emergencyLoading} className="rounded-xl bg-danger/10 px-3 py-2 text-xs font-medium text-danger hover:bg-danger/20 disabled:opacity-50">Reddet</button>}
                      {(grant.status === "requested" || grant.status === "approved") && <button onClick={() => void handleReleaseEmergencyAccessKey(grant.id)} disabled={emergencyLoading} className="rounded-xl bg-blue-500/10 px-3 py-2 text-xs font-medium text-blue-400 hover:bg-blue-500/20 disabled:opacity-50">Release</button>}
                      {grant.status !== "cancelled" && <button onClick={() => void runEmergencyAction(() => cancelEmergencyAccessGrant(grant.id), "Grant iptal edildi")} disabled={emergencyLoading} className="rounded-xl bg-danger/10 px-3 py-2 text-xs font-medium text-danger hover:bg-danger/20 disabled:opacity-50">İptal</button>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showPlaintextCsvConfirm && (
        <PlaintextExportConfirmModal
          format="CSV"
          itemCount={loginItems.length}
          description="Giriş bilgilerinin başlık, URL, kullanıcı adı, şifre ve not alanları düz metin olarak dışa aktarılacak."
          onConfirm={performExportCSV}
          onClose={() => setShowPlaintextCsvConfirm(false)}
        />
      )}
    </div>
  );
}
