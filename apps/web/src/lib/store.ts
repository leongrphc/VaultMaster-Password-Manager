"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  VaultKeyEnvelope,
  BackupCounts,
  VaultItemResponse,
  FolderResponse,
  VaultItemData,
  AuthTokens,
  AttachmentResponse,
  EmergencyAccessGrantResponse,
  SharedVaultItemResponse,
  SharedVaultMemberResponse,
  SharedVaultResponse,
} from "@vaultmaster/shared";
import {
  unwrapVaultKey,
  wrapVaultKey,
  generateAuthHash,
  deriveMasterKey,
  exportMasterKeyBase64,
  importMasterKey,
  encryptBinary,
  decryptBinary,
  encryptJSON,
  decryptJSON,
} from "@vaultmaster/crypto";
import { api, ApiError, getErrorMessage, isUnauthorizedError } from "./api";
import { notify } from "./notify";
import { createFullBackup, prepareBackupRestore, type BackupArchive } from "./full-backup";
import {
  clearLockVerifier,
  clearOfflineVaultSnapshot,
  persistLockVerifier,
  persistOfflineVaultSnapshot,
  readOfflineVaultSnapshot,
  verifyLockVerifier,
} from "./offline-cache";
import {
  clearLocalUnlock,
  getLocalUnlockStatus,
  setupLocalUnlock,
  unlockWithLocalAuthenticator,
  type LocalUnlockStatus,
} from "./local-unlock";

interface DecryptedAttachment {
  id: string;
  vaultItemId: string;
  name: string;
  type: string;
  size: number;
  createdAt: string;
  updatedAt: string;
}

interface DecryptedVaultItem {
  id: string;
  folderId: string | null;
  favorite: boolean;
  data: VaultItemData;
  attachments?: DecryptedAttachment[];
  createdAt: string;
  updatedAt: string;
}

interface AuthState {
  isAuthenticated: boolean;
  tokens: AuthTokens | null;
  userEmail: string | null;
  userId: string | null;
  currentDeviceId: string | null;
  vaultKeyEnvelope: VaultKeyEnvelope | null;
}

type VaultSortBy =
  | "name-asc"
  | "name-desc"
  | "updated-desc"
  | "updated-asc"
  | "created-desc"
  | "created-asc"
  | "type";

type VaultViewMode = "comfortable" | "compact" | "grid";

interface VaultState {
  items: DecryptedVaultItem[];
  folders: FolderResponse[];
  selectedFolderId: string | null;
  showFavoritesOnly: boolean;
  searchQuery: string;
  sortBy: VaultSortBy;
  viewMode: VaultViewMode;
  favoritesFirst: boolean;
  isSelectionMode: boolean;
  selectedItemIds: string[];
  isLoading: boolean;
  isLocked: boolean;
  isUsingOfflineData: boolean;
  lastSyncedAt: string | null;
  lockTimeoutMinutes: number;
  lastActivity: number;
  sharedVaults: SharedVaultResponse[];
  sharedVaultMembers: Record<string, SharedVaultMemberResponse[]>;
  sharedVaultItems: Record<string, SharedVaultItemResponse[]>;
  emergencyAccessGrants: EmergencyAccessGrantResponse[];
}

interface AppStore extends AuthState, VaultState {
  // In-memory data key (DEK); it is not the password-derived wrapping key.
  masterKeyBase64: string | null;

  setAuth: (
    tokens: AuthTokens,
    email: string,
    userId: string,
    deviceId?: string | null,
    envelope?: VaultKeyEnvelope | null
  ) => void;
  changeMasterPassword: (currentPassword: string, newPassword: string) => Promise<void>;
  exportFullBackup: (password: string) => Promise<void>;
  getVaultOperationGuard: () => () => void;
  restoreFullBackup: (archive: BackupArchive) => Promise<{ alreadyRestored: boolean; counts: BackupCounts }>;
  setTokens: (tokens: AuthTokens) => void;
  setMasterKey: (keyBase64: string) => void;
  bootstrapSessionSecurity: () => Promise<void>;
  logout: () => void;
  refreshAuthTokens: () => Promise<AuthTokens | null>;
  runWithValidAccessToken: <T>(
    operation: (accessToken: string) => Promise<T>
  ) => Promise<T>;

  setItems: (items: DecryptedVaultItem[]) => void;
  addItem: (item: DecryptedVaultItem) => void;
  updateItem: (id: string, item: Partial<DecryptedVaultItem>) => void;
  removeItem: (id: string) => void;

  setFolders: (folders: FolderResponse[]) => void;
  addFolder: (folder: FolderResponse) => void;
  createFolder: (name: string) => Promise<FolderResponse>;
  deleteFolder: (id: string) => Promise<void>;
  removeFolder: (id: string) => void;

  setSelectedFolderId: (id: string | null) => void;
  setShowFavoritesOnly: (show: boolean) => void;
  setSearchQuery: (query: string) => void;
  setSortBy: (sortBy: VaultSortBy) => void;
  setViewMode: (viewMode: VaultViewMode) => void;
  setFavoritesFirst: (favoritesFirst: boolean) => void;
  setSelectionMode: (enabled: boolean) => void;
  toggleSelectedItem: (id: string) => void;
  setSelectedItems: (ids: string[]) => void;
  clearSelection: () => void;
  setLoading: (loading: boolean) => void;
  syncOfflineSnapshot: () => Promise<void>;

  loadVault: () => Promise<void>;
  createVaultItem: (
    data: VaultItemData,
    folderId?: string | null,
    favorite?: boolean
  ) => Promise<void>;
  updateVaultItemFull: (
    id: string,
    data: VaultItemData,
    folderId?: string | null
  ) => Promise<void>;
  loadAttachments: (itemId: string) => Promise<void>;
  uploadAttachment: (itemId: string, file: File) => Promise<void>;
  downloadAttachment: (itemId: string, attachmentId: string) => Promise<void>;
  deleteAttachment: (itemId: string, attachmentId: string) => Promise<void>;
  deleteVaultItem: (id: string) => Promise<void>;
  toggleFavorite: (id: string) => Promise<void>;

  loadSharedVaults: () => Promise<void>;
  createSharedVault: (body: {
    encryptedMetadata: string;
    metadataIv: string;
    encryptedVaultKey: string;
    encryptedVaultKeyIv: string;
  }) => Promise<SharedVaultResponse>;
  loadSharedVaultMembers: (sharedVaultId: string) => Promise<void>;
  inviteSharedVaultMember: (
    sharedVaultId: string,
    body: {
      email: string;
      role: "viewer" | "editor" | "admin";
      encryptedVaultKey: string;
      encryptedVaultKeyIv: string;
    }
  ) => Promise<SharedVaultMemberResponse>;
  removeSharedVaultMember: (sharedVaultId: string, memberId: string) => Promise<void>;
  loadSharedVaultItems: (sharedVaultId: string) => Promise<void>;
  createSharedVaultItem: (
    sharedVaultId: string,
    body: { encryptedData: string; iv: string; favorite?: boolean }
  ) => Promise<SharedVaultItemResponse>;
  updateSharedVaultItem: (
    sharedVaultId: string,
    itemId: string,
    body: { encryptedData?: string; iv?: string; favorite?: boolean }
  ) => Promise<SharedVaultItemResponse>;
  deleteSharedVaultItem: (sharedVaultId: string, itemId: string) => Promise<void>;

  loadEmergencyAccessGrants: () => Promise<void>;
  inviteEmergencyContact: (body: {
    contactEmail: string;
    encryptedAccessKey: string;
    encryptedAccessIv: string;
    waitTimeDays: number;
  }) => Promise<EmergencyAccessGrantResponse>;
  acceptEmergencyAccessGrant: (id: string) => Promise<void>;
  requestEmergencyAccess: (id: string) => Promise<void>;
  approveEmergencyAccessRequest: (id: string) => Promise<void>;
  rejectEmergencyAccessRequest: (id: string) => Promise<void>;
  cancelEmergencyAccessGrant: (id: string) => Promise<void>;
  releaseEmergencyAccessKey: (id: string) => Promise<EmergencyAccessGrantResponse>;

  lockVault: () => void;
  unlockVault: (password: string, email: string) => Promise<boolean>;
  unlockVaultLocally: () => Promise<boolean>;
  getLocalUnlockStatus: () => LocalUnlockStatus;
  setupLocalUnlock: () => Promise<LocalUnlockStatus>;
  clearLocalUnlock: () => void;
  touchActivity: () => void;
  setLockTimeout: (minutes: number) => void;
}

function sortFoldersByName(folders: FolderResponse[]): FolderResponse[] {
  return [...folders].sort((a, b) => a.name.localeCompare(b.name, "tr"));
}

const SESSION_MASTER_KEY = "vaultmaster-session-master-key";
let vaultSecurityEpoch = 0;

function isCurrentVaultSession(state: AppStore, epoch: number, key: string | null) {
  return epoch === vaultSecurityEpoch && state.isAuthenticated && !state.isLocked &&
    Boolean(key) && state.masterKeyBase64 === key;
}

function requireCurrentVaultSession(state: AppStore, epoch: number, key: string | null): asserts key is string {
  if (!isCurrentVaultSession(state, epoch, key)) {
    throw new Error("Kasa kilitlendi veya oturum değişti. Kilidi açıp tekrar deneyin.");
  }
}

let refreshInFlight: Promise<AuthTokens | null> | null = null;

function safeFileName(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, "_") || "attachment";
}

async function decryptAttachmentMetadata(
  attachment: AttachmentResponse,
  masterKey: CryptoKey
): Promise<DecryptedAttachment> {
  const metadata = await decryptJSON<{ name?: string; type?: string }>(
    attachment.encryptedMetadata,
    attachment.metadataIv,
    masterKey
  );

  return {
    id: attachment.id,
    vaultItemId: attachment.vaultItemId,
    name: typeof metadata.name === "string" && metadata.name ? metadata.name : "attachment",
    type: typeof metadata.type === "string" ? metadata.type : "application/octet-stream",
    size: attachment.size,
    createdAt: attachment.createdAt,
    updatedAt: attachment.updatedAt,
  };
}

function downloadBlob(data: Blob, fileName: string) {
  const url = URL.createObjectURL(data);
  const link = document.createElement("a");
  link.href = url;
  link.download = safeFileName(fileName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function clearLegacySessionMasterKey() {
  if (typeof window !== "undefined") {
    sessionStorage.removeItem(SESSION_MASTER_KEY);
  }
}

export const useStore = create<AppStore>()(
  persist(
    (set, get) => ({
      isAuthenticated: false,
      tokens: null,
      userEmail: null,
      userId: null,
      currentDeviceId: null,
      masterKeyBase64: null,
      vaultKeyEnvelope: null,

      items: [],
      folders: [],
      selectedFolderId: null,
      showFavoritesOnly: false,
      searchQuery: "",
      sortBy: "updated-desc",
      viewMode: "comfortable",
      favoritesFirst: true,
      isSelectionMode: false,
      selectedItemIds: [],
      isLoading: false,
      isLocked: false,
      isUsingOfflineData: false,
      lastSyncedAt: null,
      lockTimeoutMinutes: 5,
      lastActivity: Date.now(),
      sharedVaults: [],
      sharedVaultMembers: {},
      sharedVaultItems: {},
      emergencyAccessGrants: [],

      setAuth: (tokens, email, userId, deviceId = null, envelope = null) => {
        vaultSecurityEpoch++;
        clearLegacySessionMasterKey();
        set({
          isAuthenticated: true, tokens, userEmail: email, userId,
          vaultKeyEnvelope: envelope, currentDeviceId: deviceId, isLocked: true, masterKeyBase64: null,
          items: [], folders: [], isLoading: false,
        });
      },

      getVaultOperationGuard: () => {
        const epoch = vaultSecurityEpoch;
        const key = get().masterKeyBase64;
        return () => requireCurrentVaultSession(get(), epoch, key);
      },

      exportFullBackup: async (password) => {
        const epoch = vaultSecurityEpoch;
        const key = get().masterKeyBase64;
        const assertCurrent = () => requireCurrentVaultSession(get(), epoch, key);
        requireCurrentVaultSession(get(), epoch, key);
        const response = await get().runWithValidAccessToken(token => { assertCurrent(); return api.backups.snapshot(token); });
        assertCurrent();
        const file = await createFullBackup({ ...response.data, scope: "personal-vault", vaultKeyBase64: key }, password, assertCurrent);
        assertCurrent();
        const url = URL.createObjectURL(new Blob([file], { type: "application/json" }));
        try {
          const link = document.createElement("a");
          link.href = url; link.download = `vaultmaster-full-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click();
        } finally { URL.revokeObjectURL(url); }
      },

      restoreFullBackup: async (archive) => {
        const epoch = vaultSecurityEpoch;
        const key = get().masterKeyBase64;
        const assertCurrent = () => requireCurrentVaultSession(get(), epoch, key);
        requireCurrentVaultSession(get(), epoch, key);
        const body = await prepareBackupRestore(archive, key, assertCurrent);
        assertCurrent();
        const response = await get().runWithValidAccessToken(token => { assertCurrent(); return api.backups.restore(body, token); });
        assertCurrent();
        await get().loadVault();
        assertCurrent();
        return response.data;
      },

      changeMasterPassword: async (currentPassword, newPassword) => {
        const epoch = vaultSecurityEpoch;
        const { masterKeyBase64, userEmail, userId, currentDeviceId, vaultKeyEnvelope } = get();
        requireCurrentVaultSession(get(), epoch, masterKeyBase64);
        if (!userEmail || newPassword.length < 8) throw new Error("Geçersiz ana şifre");
        const passwordKey = await deriveMasterKey(currentPassword, userEmail);
        const currentVaultKey = vaultKeyEnvelope ? await unwrapVaultKey(vaultKeyEnvelope, passwordKey) : passwordKey;
        if (await exportMasterKeyBase64(currentVaultKey) !== masterKeyBase64) throw new Error("Mevcut ana şifre doğrulanamadı");
        const nextPasswordKey = await deriveMasterKey(newPassword, userEmail);
        const wrapped = await wrapVaultKey(currentVaultKey, nextPasswordKey);
        // Verify the new envelope locally before committing anything remotely.
        if (await exportMasterKeyBase64(await unwrapVaultKey(wrapped, nextPasswordKey)) !== masterKeyBase64) {
          throw new Error("Kasa anahtarı doğrulanamadı");
        }
        const currentAuthHash = await generateAuthHash(passwordKey, currentPassword);
        const newAuthHash = await generateAuthHash(nextPasswordKey, newPassword);
        requireCurrentVaultSession(get(), epoch, masterKeyBase64);
        await get().runWithValidAccessToken(accessToken => {
          requireCurrentVaultSession(get(), epoch, masterKeyBase64);
          return api.auth.changePassword({ currentAuthHash, newAuthHash, kdfIterations: 600000,
            expectedVaultKeyVersion: vaultKeyEnvelope?.version ?? 0, vaultKeyEnvelope: wrapped }, accessToken);
        });
        // An in-flight change may finish after locking. Update only the encrypted
        // envelope for this session, without restoring any plaintext or key.
        if (get().isAuthenticated && get().userId === userId && get().currentDeviceId === currentDeviceId) {
          set({ vaultKeyEnvelope: { ...wrapped, version: (vaultKeyEnvelope?.version ?? 0) + 1 } });
        }
      },

      setTokens: (tokens) => set({ tokens }),

      setMasterKey: (keyBase64) => {
        const epoch = ++vaultSecurityEpoch;
        clearLegacySessionMasterKey();
        set({ masterKeyBase64: keyBase64, isLocked: false, lastActivity: Date.now() });
        void persistLockVerifier(keyBase64, () => isCurrentVaultSession(get(), epoch, keyBase64))
          .catch(() => notify.error("Yerel kilit doğrulaması kaydedilemedi."));
      },

      bootstrapSessionSecurity: async () => {
        clearLegacySessionMasterKey();
        const state = get();
        if (state.isAuthenticated && (!state.masterKeyBase64 || state.isLocked)) {
          get().lockVault();
        }
      },

      logout: () =>
        set(() => {
          vaultSecurityEpoch++;
          clearLegacySessionMasterKey();
          clearOfflineVaultSnapshot();
          clearLockVerifier();
          clearLocalUnlock();

          return {
            isAuthenticated: false,
            tokens: null,
            userEmail: null,
            userId: null,
            currentDeviceId: null,
            vaultKeyEnvelope: null,
            masterKeyBase64: null,
            items: [],
            folders: [],
            isLoading: false,
            selectedItemIds: [],
            isSelectionMode: false,
            selectedFolderId: null,
            showFavoritesOnly: false,
            searchQuery: "",
            isLocked: false,
            isUsingOfflineData: false,
            lastSyncedAt: null,
            sharedVaults: [],
            sharedVaultMembers: {},
            sharedVaultItems: {},
            emergencyAccessGrants: [],
          };
        }),

      refreshAuthTokens: async () => {
        if (refreshInFlight) {
          return refreshInFlight;
        }

        const currentTokens = get().tokens;
        if (!currentTokens) {
          return null;
        }

        refreshInFlight = (async () => {
          try {
            const response = (await api.auth.refresh(currentTokens.refreshToken)) as {
              data: { tokens: AuthTokens; deviceId?: string | null };
            };
            if (get().tokens?.refreshToken !== currentTokens.refreshToken) return null;
            set({
              tokens: response.data.tokens,
              currentDeviceId: response.data.deviceId ?? get().currentDeviceId,
            });
            return response.data.tokens;
          } catch (error) {
            console.error("Token yenileme hatası:", error);
            if (get().tokens?.refreshToken === currentTokens.refreshToken) {
              notify.sessionExpired();
              get().logout();
            }
            return null;
          } finally {
            refreshInFlight = null;
          }
        })();

        return refreshInFlight;
      },

      runWithValidAccessToken: async <T>(
        operation: (accessToken: string) => Promise<T>
      ) => {
        const currentTokens = get().tokens;
        if (!currentTokens) {
          throw new Error("Oturum bulunamadı");
        }

        try {
          return await operation(currentTokens.accessToken);
        } catch (error) {
          if (!isUnauthorizedError(error)) {
            throw error;
          }

          const refreshedTokens = await get().refreshAuthTokens();
          if (!refreshedTokens) {
            throw new Error("Oturum süresi doldu. Lütfen tekrar giriş yapın.");
          }

          return operation(refreshedTokens.accessToken);
        }
      },

      setItems: (items) => set({ items }),
      addItem: (item) => {
        set((state) => ({ items: [item, ...state.items] }));
        void get().syncOfflineSnapshot();
      },
      updateItem: (id, updates) => {
        set((state) => ({
          items: state.items.map((item) =>
            item.id === id ? { ...item, ...updates } : item
          ),
        }));
        void get().syncOfflineSnapshot();
      },
      removeItem: (id) => {
        set((state) => ({ items: state.items.filter((item) => item.id !== id) }));
        void get().syncOfflineSnapshot();
      },

      setFolders: (folders) => set({ folders: sortFoldersByName(folders) }),
      addFolder: (folder) => {
        set((state) => ({
          folders: sortFoldersByName([...state.folders, folder]),
        }));
        void get().syncOfflineSnapshot();
      },
      createFolder: async (name) => {
        const response = (await get().runWithValidAccessToken((accessToken) =>
          api.folders.create({ name }, accessToken) as Promise<{ data: FolderResponse }>
        )) as { data: FolderResponse };

        get().addFolder(response.data);
        return response.data;
      },
      deleteFolder: async (id) => {
        await get().runWithValidAccessToken((accessToken) =>
          api.folders.delete(id, accessToken)
        );
        get().removeFolder(id);
      },
      removeFolder: (id) => {
        set((state) => ({
          folders: state.folders.filter((folder) => folder.id !== id),
          items: state.items.map((item) =>
            item.folderId === id ? { ...item, folderId: null } : item
          ),
          selectedFolderId: state.selectedFolderId === id ? null : state.selectedFolderId,
        }));
        void get().syncOfflineSnapshot();
      },

      setSelectedFolderId: (id) =>
        set({ selectedFolderId: id, showFavoritesOnly: false }),
      setShowFavoritesOnly: (show) =>
        set({ showFavoritesOnly: show, selectedFolderId: null }),
      setSearchQuery: (query) => set({ searchQuery: query }),
      setSortBy: (sortBy) => set({ sortBy }),
      setViewMode: (viewMode) => set({ viewMode }),
      setFavoritesFirst: (favoritesFirst) => set({ favoritesFirst }),
      setSelectionMode: (enabled) =>
        set({ isSelectionMode: enabled, selectedItemIds: enabled ? get().selectedItemIds : [] }),
      toggleSelectedItem: (id) =>
        set((state) => ({
          selectedItemIds: state.selectedItemIds.includes(id)
            ? state.selectedItemIds.filter((itemId) => itemId !== id)
            : [...state.selectedItemIds, id],
        })),
      setSelectedItems: (ids) => set({ selectedItemIds: Array.from(new Set(ids)) }),
      clearSelection: () => set({ selectedItemIds: [], isSelectionMode: false }),
      setLoading: (loading) => set({ isLoading: loading }),
      syncOfflineSnapshot: async () => {
        const epoch = vaultSecurityEpoch;
        const { isAuthenticated, isLocked, items, folders, masterKeyBase64 } = get();
        if (!isAuthenticated || isLocked || !masterKeyBase64) {
          return;
        }

        try {
          const savedAt = await persistOfflineVaultSnapshot({
            items,
            folders,
            masterKeyBase64,
            isCurrent: () => isCurrentVaultSession(get(), epoch, masterKeyBase64),
          });

          if (savedAt && isCurrentVaultSession(get(), epoch, masterKeyBase64)) {
            set({ lastSyncedAt: savedAt });
          }
        } catch (error) {
          console.error("Offline snapshot kaydedilemedi:", error);
        }
      },

      loadVault: async () => {
        const epoch = vaultSecurityEpoch;
        const { tokens, masterKeyBase64 } = get();
        if (!tokens || !masterKeyBase64 || !isCurrentVaultSession(get(), epoch, masterKeyBase64)) {
          return;
        }

        set({ isLoading: true });
        try {
          const masterKey = await importMasterKey(masterKeyBase64);

          const [vaultResponse, foldersResponse] = await Promise.all([
            get().runWithValidAccessToken(
              (accessToken) =>
                api.vault.getAll(accessToken) as Promise<{ data: VaultItemResponse[] }>
            ),
            get().runWithValidAccessToken(
              (accessToken) =>
                api.folders.getAll(accessToken) as Promise<{ data: FolderResponse[] }>
            ),
          ]);

          if (!isCurrentVaultSession(get(), epoch, masterKeyBase64)) return;
          const decryptedItems: DecryptedVaultItem[] = [];
          for (const item of vaultResponse.data) {
            try {
              const data = await decryptJSON<VaultItemData>(
                item.encryptedData,
                item.iv,
                masterKey
              );
              decryptedItems.push({
                id: item.id,
                folderId: item.folderId,
                favorite: item.favorite,
                data,
                createdAt: item.createdAt,
                updatedAt: item.updatedAt,
              });
            } catch (error) {
              console.error("Vault çözme hatası:", item.id, error);
            }
          }

          if (!isCurrentVaultSession(get(), epoch, masterKeyBase64)) return;
          set({
            items: decryptedItems,
            folders: sortFoldersByName(foldersResponse.data),
            isLoading: false,
            isUsingOfflineData: false,
          });

          const savedAt = await persistOfflineVaultSnapshot({
            items: decryptedItems,
            folders: foldersResponse.data,
            masterKeyBase64,
            isCurrent: () => isCurrentVaultSession(get(), epoch, masterKeyBase64),
          });

          if (savedAt && isCurrentVaultSession(get(), epoch, masterKeyBase64)) {
            set({ lastSyncedAt: savedAt });
          }
        } catch (error) {
          if (!isCurrentVaultSession(get(), epoch, masterKeyBase64)) return;
          console.error("Vault yükleme hatası:", error);

          try {
            const snapshot = await readOfflineVaultSnapshot(masterKeyBase64);
            if (snapshot && isCurrentVaultSession(get(), epoch, masterKeyBase64)) {
              set({
                items: snapshot.items,
                folders: sortFoldersByName(snapshot.folders),
                isLoading: false,
                isUsingOfflineData: true,
                lastSyncedAt: snapshot.savedAt,
              });
              notify.offlineMode();
              return;
            }
          } catch (offlineError) {
            console.error("Offline snapshot okunamadı:", offlineError);
          }

          if (!isCurrentVaultSession(get(), epoch, masterKeyBase64)) return;
          notify.error(getErrorMessage(error, "Kasa yüklenirken hata oluştu."));
          set({ isLoading: false });
        }
      },

      createVaultItem: async (data, folderId = null, favorite = false) => {
        const epoch = vaultSecurityEpoch;
        const { masterKeyBase64 } = get();
        requireCurrentVaultSession(get(), epoch, masterKeyBase64);

        const masterKey = await importMasterKey(masterKeyBase64);
        const encrypted = await encryptJSON(data, masterKey);

        requireCurrentVaultSession(get(), epoch, masterKeyBase64);
        const response = (await get().runWithValidAccessToken((accessToken) =>
          api.vault.create(
            {
              encryptedData: encrypted.ciphertext,
              iv: encrypted.iv,
              folderId,
              favorite,
            },
            accessToken
          ) as Promise<{ data: VaultItemResponse }>
        )) as { data: VaultItemResponse };

        requireCurrentVaultSession(get(), epoch, masterKeyBase64);
        get().addItem({
          id: response.data.id,
          folderId: response.data.folderId,
          favorite: response.data.favorite,
          data,
          createdAt: response.data.createdAt,
          updatedAt: response.data.updatedAt,
        });
      },

      updateVaultItemFull: async (id, data, folderId = null) => {
        const epoch = vaultSecurityEpoch;
        const { masterKeyBase64 } = get();
        requireCurrentVaultSession(get(), epoch, masterKeyBase64);

        const masterKey = await importMasterKey(masterKeyBase64);
        const encrypted = await encryptJSON(data, masterKey);

        requireCurrentVaultSession(get(), epoch, masterKeyBase64);
        const response = (await get().runWithValidAccessToken((accessToken) =>
          api.vault.update(
            id,
            {
              encryptedData: encrypted.ciphertext,
              iv: encrypted.iv,
              folderId,
            },
            accessToken
          ) as Promise<{ data: VaultItemResponse }>
        )) as { data: VaultItemResponse };

        requireCurrentVaultSession(get(), epoch, masterKeyBase64);
        get().updateItem(id, {
          data,
          folderId: response.data.folderId,
          updatedAt: response.data.updatedAt,
        });
      },

      loadAttachments: async (itemId) => {
        const epoch = vaultSecurityEpoch;
        const { masterKeyBase64 } = get();
        requireCurrentVaultSession(get(), epoch, masterKeyBase64);

        const masterKey = await importMasterKey(masterKeyBase64);
        requireCurrentVaultSession(get(), epoch, masterKeyBase64);
        const response = (await get().runWithValidAccessToken((accessToken) =>
          api.vault.getAttachments(itemId, accessToken) as Promise<{ data: AttachmentResponse[] }>
        )) as { data: AttachmentResponse[] };

        const attachments: DecryptedAttachment[] = [];
        for (const attachment of response.data) {
          try {
            attachments.push(await decryptAttachmentMetadata(attachment, masterKey));
          } catch (error) {
            console.error("Ek metadata çözme hatası:", attachment.id, error);
          }
        }

        requireCurrentVaultSession(get(), epoch, masterKeyBase64);
        get().updateItem(itemId, { attachments });
      },

      uploadAttachment: async (itemId, file) => {
        const epoch = vaultSecurityEpoch;
        const { masterKeyBase64 } = get();
        requireCurrentVaultSession(get(), epoch, masterKeyBase64);

        const masterKey = await importMasterKey(masterKeyBase64);
        const [metadata, encryptedFile] = await Promise.all([
          encryptJSON({ name: file.name, type: file.type || "application/octet-stream" }, masterKey),
          encryptBinary(await file.arrayBuffer(), masterKey),
        ]);

        requireCurrentVaultSession(get(), epoch, masterKeyBase64);
        const response = (await get().runWithValidAccessToken((accessToken) =>
          api.vault.createAttachment(
            itemId,
            {
              encryptedMetadata: metadata.ciphertext,
              metadataIv: metadata.iv,
              encryptedBlob: encryptedFile.ciphertext,
              blobIv: encryptedFile.iv,
              size: file.size,
            },
            accessToken
          ) as Promise<{ data: AttachmentResponse }>
        )) as { data: AttachmentResponse };

        const attachment = await decryptAttachmentMetadata(response.data, masterKey);
        requireCurrentVaultSession(get(), epoch, masterKeyBase64);
        get().updateItem(itemId, {
          attachments: [
            attachment,
            ...(get().items.find((item) => item.id === itemId)?.attachments ?? []),
          ],
        });
      },

      downloadAttachment: async (itemId, attachmentId) => {
        const epoch = vaultSecurityEpoch;
        const { masterKeyBase64 } = get();
        requireCurrentVaultSession(get(), epoch, masterKeyBase64);

        const masterKey = await importMasterKey(masterKeyBase64);
        requireCurrentVaultSession(get(), epoch, masterKeyBase64);
        const response = (await get().runWithValidAccessToken((accessToken) =>
          api.vault.getAttachment(itemId, attachmentId, accessToken) as Promise<{ data: AttachmentResponse }>
        )) as { data: AttachmentResponse };

        const [metadata, data] = await Promise.all([
          decryptAttachmentMetadata(response.data, masterKey),
          decryptBinary(response.data.encryptedBlob, response.data.blobIv, masterKey),
        ]);

        requireCurrentVaultSession(get(), epoch, masterKeyBase64);
        downloadBlob(new Blob([data], { type: metadata.type }), metadata.name);
      },

      deleteAttachment: async (itemId, attachmentId) => {
        await get().runWithValidAccessToken((accessToken) =>
          api.vault.deleteAttachment(itemId, attachmentId, accessToken)
        );

        get().updateItem(itemId, {
          attachments: (get().items.find((item) => item.id === itemId)?.attachments ?? []).filter(
            (attachment) => attachment.id !== attachmentId
          ),
        });
      },

      deleteVaultItem: async (id) => {
        await get().runWithValidAccessToken((accessToken) =>
          api.vault.delete(id, accessToken)
        );
        get().removeItem(id);
      },

      toggleFavorite: async (id) => {
        const { items } = get();
        const item = items.find((entry) => entry.id === id);
        if (!item) {
          return;
        }

        await get().runWithValidAccessToken((accessToken) =>
          api.vault.update(id, { favorite: !item.favorite }, accessToken)
        );
        get().updateItem(id, { favorite: !item.favorite });
      },

      loadSharedVaults: async () => {
        const response = (await get().runWithValidAccessToken((accessToken) =>
          api.sharedVaults.getAll(accessToken) as Promise<{ data: SharedVaultResponse[] }>
        )) as { data: SharedVaultResponse[] };

        set({ sharedVaults: response.data });
      },

      createSharedVault: async (body) => {
        const response = (await get().runWithValidAccessToken((accessToken) =>
          api.sharedVaults.create(body, accessToken) as Promise<{ data: SharedVaultResponse }>
        )) as { data: SharedVaultResponse };

        set((state) => ({ sharedVaults: [response.data, ...state.sharedVaults] }));
        return response.data;
      },

      loadSharedVaultMembers: async (sharedVaultId) => {
        const response = (await get().runWithValidAccessToken((accessToken) =>
          api.sharedVaults.getMembers(sharedVaultId, accessToken) as Promise<{ data: SharedVaultMemberResponse[] }>
        )) as { data: SharedVaultMemberResponse[] };

        set((state) => ({
          sharedVaultMembers: {
            ...state.sharedVaultMembers,
            [sharedVaultId]: response.data,
          },
        }));
      },

      inviteSharedVaultMember: async (sharedVaultId, body) => {
        const response = (await get().runWithValidAccessToken((accessToken) =>
          api.sharedVaults.invite(sharedVaultId, body, accessToken) as Promise<{ data: SharedVaultMemberResponse }>
        )) as { data: SharedVaultMemberResponse };

        set((state) => ({
          sharedVaultMembers: {
            ...state.sharedVaultMembers,
            [sharedVaultId]: [
              ...(state.sharedVaultMembers[sharedVaultId] ?? []),
              response.data,
            ],
          },
        }));
        return response.data;
      },

      removeSharedVaultMember: async (sharedVaultId, memberId) => {
        await get().runWithValidAccessToken((accessToken) =>
          api.sharedVaults.removeMember(sharedVaultId, memberId, accessToken)
        );

        set((state) => ({
          sharedVaultMembers: {
            ...state.sharedVaultMembers,
            [sharedVaultId]: (state.sharedVaultMembers[sharedVaultId] ?? []).filter(
              (member) => member.id !== memberId
            ),
          },
        }));
      },

      loadSharedVaultItems: async (sharedVaultId) => {
        const response = (await get().runWithValidAccessToken((accessToken) =>
          api.sharedVaults.getItems(sharedVaultId, accessToken) as Promise<{ data: SharedVaultItemResponse[] }>
        )) as { data: SharedVaultItemResponse[] };

        set((state) => ({
          sharedVaultItems: {
            ...state.sharedVaultItems,
            [sharedVaultId]: response.data,
          },
        }));
      },

      createSharedVaultItem: async (sharedVaultId, body) => {
        const response = (await get().runWithValidAccessToken((accessToken) =>
          api.sharedVaults.createItem(sharedVaultId, body, accessToken) as Promise<{ data: SharedVaultItemResponse }>
        )) as { data: SharedVaultItemResponse };

        set((state) => ({
          sharedVaultItems: {
            ...state.sharedVaultItems,
            [sharedVaultId]: [response.data, ...(state.sharedVaultItems[sharedVaultId] ?? [])],
          },
        }));
        return response.data;
      },

      updateSharedVaultItem: async (sharedVaultId, itemId, body) => {
        const response = (await get().runWithValidAccessToken((accessToken) =>
          api.sharedVaults.updateItem(sharedVaultId, itemId, body, accessToken) as Promise<{ data: SharedVaultItemResponse }>
        )) as { data: SharedVaultItemResponse };

        set((state) => ({
          sharedVaultItems: {
            ...state.sharedVaultItems,
            [sharedVaultId]: (state.sharedVaultItems[sharedVaultId] ?? []).map((item) =>
              item.id === itemId ? response.data : item
            ),
          },
        }));
        return response.data;
      },

      deleteSharedVaultItem: async (sharedVaultId, itemId) => {
        await get().runWithValidAccessToken((accessToken) =>
          api.sharedVaults.deleteItem(sharedVaultId, itemId, accessToken)
        );

        set((state) => ({
          sharedVaultItems: {
            ...state.sharedVaultItems,
            [sharedVaultId]: (state.sharedVaultItems[sharedVaultId] ?? []).filter((item) => item.id !== itemId),
          },
        }));
      },

      loadEmergencyAccessGrants: async () => {
        const response = (await get().runWithValidAccessToken((accessToken) =>
          api.emergencyAccess.getAll(accessToken) as Promise<{ data: EmergencyAccessGrantResponse[] }>
        )) as { data: EmergencyAccessGrantResponse[] };

        set({ emergencyAccessGrants: response.data });
      },

      inviteEmergencyContact: async (body) => {
        const response = (await get().runWithValidAccessToken((accessToken) =>
          api.emergencyAccess.invite(body, accessToken) as Promise<{ data: EmergencyAccessGrantResponse }>
        )) as { data: EmergencyAccessGrantResponse };

        set((state) => ({ emergencyAccessGrants: [response.data, ...state.emergencyAccessGrants] }));
        return response.data;
      },

      acceptEmergencyAccessGrant: async (id) => {
        const response = (await get().runWithValidAccessToken((accessToken) =>
          api.emergencyAccess.accept(id, accessToken) as Promise<{ data: EmergencyAccessGrantResponse }>
        )) as { data: EmergencyAccessGrantResponse };

        set((state) => ({
          emergencyAccessGrants: state.emergencyAccessGrants.map((grant) =>
            grant.id === id ? response.data : grant
          ),
        }));
      },

      requestEmergencyAccess: async (id) => {
        const response = (await get().runWithValidAccessToken((accessToken) =>
          api.emergencyAccess.request(id, accessToken) as Promise<{ data: EmergencyAccessGrantResponse }>
        )) as { data: EmergencyAccessGrantResponse };

        set((state) => ({
          emergencyAccessGrants: state.emergencyAccessGrants.map((grant) =>
            grant.id === id ? response.data : grant
          ),
        }));
      },

      approveEmergencyAccessRequest: async (id) => {
        const response = (await get().runWithValidAccessToken((accessToken) =>
          api.emergencyAccess.approve(id, accessToken) as Promise<{ data: EmergencyAccessGrantResponse }>
        )) as { data: EmergencyAccessGrantResponse };

        set((state) => ({
          emergencyAccessGrants: state.emergencyAccessGrants.map((grant) =>
            grant.id === id ? response.data : grant
          ),
        }));
      },

      rejectEmergencyAccessRequest: async (id) => {
        const response = (await get().runWithValidAccessToken((accessToken) =>
          api.emergencyAccess.reject(id, accessToken) as Promise<{ data: EmergencyAccessGrantResponse }>
        )) as { data: EmergencyAccessGrantResponse };

        set((state) => ({
          emergencyAccessGrants: state.emergencyAccessGrants.map((grant) =>
            grant.id === id ? response.data : grant
          ),
        }));
      },

      cancelEmergencyAccessGrant: async (id) => {
        const response = (await get().runWithValidAccessToken((accessToken) =>
          api.emergencyAccess.cancel(id, accessToken) as Promise<{ data: EmergencyAccessGrantResponse }>
        )) as { data: EmergencyAccessGrantResponse };

        set((state) => ({
          emergencyAccessGrants: state.emergencyAccessGrants.map((grant) =>
            grant.id === id ? response.data : grant
          ),
        }));
      },

      releaseEmergencyAccessKey: async (id) => {
        const response = (await get().runWithValidAccessToken((accessToken) =>
          api.emergencyAccess.release(id, accessToken) as Promise<{ data: EmergencyAccessGrantResponse }>
        )) as { data: EmergencyAccessGrantResponse };

        set((state) => ({
          emergencyAccessGrants: state.emergencyAccessGrants.map((grant) =>
            grant.id === id ? response.data : grant
          ),
        }));
        return response.data;
      },

      lockVault: () =>
        {
          vaultSecurityEpoch++;
          clearLegacySessionMasterKey();
          return set({
            isLocked: true,
            masterKeyBase64: null,
            items: [],
            folders: [],
            selectedFolderId: null,
            showFavoritesOnly: false,
            isLoading: false,
            selectedItemIds: [],
            isSelectionMode: false,
            searchQuery: "",
          });
        },

      unlockVault: async (password, email) => {
        const epoch = vaultSecurityEpoch;
        const userId = get().userId;
        if (!get().isAuthenticated || !userId) return false;
        const isCurrent = () => vaultSecurityEpoch === epoch && get().userId === userId && get().isAuthenticated;
        try {
          // Refresh encrypted metadata before unlock. This also recovers after a
          // successful password change whose HTTP response was lost.
          try {
            const response = await get().runWithValidAccessToken(token => api.auth.getVaultKey(token));
            if (!isCurrent()) return false;
            const envelope = response.data.vaultKeyEnvelope;
            if ((envelope?.version ?? 0) < (get().vaultKeyEnvelope?.version ?? 0)) return false;
            set({ vaultKeyEnvelope: envelope });
          } catch (error) {
            // Only an unreachable API allows the encrypted offline envelope.
            // Authentication or server errors must not silently bypass checks.
            if (!(error instanceof ApiError) || error.status !== 0) return false;
          }
          const passwordKey = await deriveMasterKey(password, email);
          const envelope = get().vaultKeyEnvelope;
          const masterKey = envelope ? await unwrapVaultKey(envelope, passwordKey) : passwordKey;
          const keyBase64 = await exportMasterKeyBase64(masterKey);

          const verifierMatches = await verifyLockVerifier(keyBase64);
          const offlineSnapshot = verifierMatches
            ? null
            : await readOfflineVaultSnapshot(keyBase64);

          if (!verifierMatches && !offlineSnapshot) {
            return false;
          }

          if (!isCurrent()) return false;
          await persistLockVerifier(keyBase64, isCurrent);
          if (!isCurrent()) return false;
          const unlockedEpoch = ++vaultSecurityEpoch;
          clearLegacySessionMasterKey();
          set({
            isLocked: false,
            masterKeyBase64: keyBase64,
            lastActivity: Date.now(),
          });
          await get().loadVault();
          return isCurrentVaultSession(get(), unlockedEpoch, keyBase64);
        } catch {
          return false;
        }
      },

      unlockVaultLocally: async () => {
        const epoch = vaultSecurityEpoch;
        const userId = get().userId;
        if (!get().isAuthenticated || !userId) return false;
        const isCurrent = () => vaultSecurityEpoch === epoch && get().userId === userId && get().isAuthenticated;
        try {
          const keyBase64 = await unlockWithLocalAuthenticator();
          const verifierMatches = await verifyLockVerifier(keyBase64);
          const offlineSnapshot = verifierMatches
            ? null
            : await readOfflineVaultSnapshot(keyBase64);

          if (!isCurrent()) return false;
          if (!verifierMatches && !offlineSnapshot) {
            clearLocalUnlock();
            return false;
          }

          if (!isCurrent()) return false;
          await persistLockVerifier(keyBase64, isCurrent);
          if (!isCurrent()) return false;
          const unlockedEpoch = ++vaultSecurityEpoch;
          clearLegacySessionMasterKey();
          set({
            isLocked: false,
            masterKeyBase64: keyBase64,
            lastActivity: Date.now(),
          });
          await get().loadVault();
          return isCurrentVaultSession(get(), unlockedEpoch, keyBase64);
        } catch {
          return false;
        }
      },

      getLocalUnlockStatus,

      setupLocalUnlock: async () => {
        const { masterKeyBase64, userEmail, userId } = get();
        if (!masterKeyBase64 || !userEmail || !userId) {
          throw new Error("Yerel kilit açma için kilidi açık bir oturum gerekir");
        }

        return setupLocalUnlock({ masterKeyBase64, userEmail, userId });
      },

      clearLocalUnlock,

      touchActivity: () =>
        set((state) => {
          const now = Date.now();
          if (now - state.lastActivity < 1000) {
            return state;
          }

          return { lastActivity: now };
        }),

      setLockTimeout: (minutes) => set({ lockTimeoutMinutes: minutes }),
    }),
    {
      name: "vaultmaster-auth",
      version: 4,
      migrate: (persistedState: unknown) => persistedState,
      merge: (persistedState: unknown, currentState: AppStore) => {
        clearLegacySessionMasterKey();
        vaultSecurityEpoch++;
        const state = (persistedState ?? {}) as Partial<AppStore>;
        return {
          ...currentState,
          isAuthenticated: Boolean(state.isAuthenticated),
          tokens: state.tokens ?? null,
          userEmail: state.userEmail ?? null,
          userId: state.userId ?? null,
          currentDeviceId: state.currentDeviceId ?? null,
          vaultKeyEnvelope: state.vaultKeyEnvelope ?? null,
          lockTimeoutMinutes: state.lockTimeoutMinutes ?? 5,
          showFavoritesOnly: false,
          sortBy: state.sortBy ?? "updated-desc",
          viewMode: state.viewMode ?? "comfortable",
          favoritesFirst: state.favoritesFirst ?? true,
          masterKeyBase64: null,
          items: [], folders: [], isLoading: false,
          isLocked: Boolean(state.isAuthenticated),
        };
      },
      partialize: (state: AppStore) => ({
        isAuthenticated: state.isAuthenticated,
        tokens: state.tokens,
        userEmail: state.userEmail,
        userId: state.userId,
        currentDeviceId: state.currentDeviceId,
        vaultKeyEnvelope: state.vaultKeyEnvelope,
        lockTimeoutMinutes: state.lockTimeoutMinutes,
        showFavoritesOnly: state.showFavoritesOnly,
        sortBy: state.sortBy,
        viewMode: state.viewMode,
        favoritesFirst: state.favoritesFirst,
      }),
    } as never
  )
);

export type { DecryptedVaultItem, VaultSortBy, VaultViewMode };
