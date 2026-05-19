"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
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
  deriveMasterKey,
  exportMasterKeyBase64,
  importMasterKey,
  encryptBinary,
  decryptBinary,
  encryptJSON,
  decryptJSON,
} from "@vaultmaster/crypto";
import { api, getErrorMessage, isUnauthorizedError } from "./api";
import { notify } from "./notify";
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
  masterKeyBase64: string | null;

  setAuth: (
    tokens: AuthTokens,
    email: string,
    userId: string,
    deviceId?: string | null
  ) => void;
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

function readSessionMasterKey(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return sessionStorage.getItem(SESSION_MASTER_KEY);
}

function writeSessionMasterKey(value: string | null) {
  if (typeof window === "undefined") {
    return;
  }

  if (!value) {
    sessionStorage.removeItem(SESSION_MASTER_KEY);
    return;
  }

  sessionStorage.setItem(SESSION_MASTER_KEY, value);
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

      setAuth: (tokens, email, userId, deviceId = null) =>
        set({
          isAuthenticated: true,
          tokens,
          userEmail: email,
          userId,
          currentDeviceId: deviceId,
          isLocked: false,
        }),

      setTokens: (tokens) => set({ tokens }),

      setMasterKey: (keyBase64) => {
        set({ masterKeyBase64: keyBase64, isLocked: false });
        writeSessionMasterKey(keyBase64);
        void persistLockVerifier(keyBase64);
      },

      bootstrapSessionSecurity: async () => {
        const { isAuthenticated, masterKeyBase64 } = get();
        if (!isAuthenticated) {
          return;
        }

        const activeMasterKey = masterKeyBase64 || readSessionMasterKey();

        if (activeMasterKey) {
          try {
            writeSessionMasterKey(activeMasterKey);
            await persistLockVerifier(activeMasterKey);
            set({ isLocked: false, masterKeyBase64: activeMasterKey });
            return;
          } catch (error) {
            console.error("Oturum güvenliği hazırlanamadı:", error);
          }
        }

        writeSessionMasterKey(null);
        set({
          isLocked: true,
          masterKeyBase64: null,
          items: [],
          folders: [],
          selectedFolderId: null,
          showFavoritesOnly: false,
        });
      },

      logout: () =>
        set(() => {
          writeSessionMasterKey(null);
          clearOfflineVaultSnapshot();
          clearLockVerifier();
          clearLocalUnlock();

          return {
            isAuthenticated: false,
            tokens: null,
            userEmail: null,
            userId: null,
            currentDeviceId: null,
            masterKeyBase64: null,
            items: [],
            folders: [],
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
            set({
              tokens: response.data.tokens,
              currentDeviceId: response.data.deviceId ?? get().currentDeviceId,
            });
            return response.data.tokens;
          } catch (error) {
            console.error("Token yenileme hatası:", error);
            notify.sessionExpired();
            get().logout();
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
        const { isAuthenticated, isLocked, items, folders, masterKeyBase64 } = get();
        if (!isAuthenticated || isLocked || !masterKeyBase64) {
          return;
        }

        try {
          const savedAt = await persistOfflineVaultSnapshot({
            items,
            folders,
            masterKeyBase64,
          });

          if (savedAt) {
            set({ lastSyncedAt: savedAt });
          }
        } catch (error) {
          console.error("Offline snapshot kaydedilemedi:", error);
        }
      },

      loadVault: async () => {
        const { tokens, masterKeyBase64 } = get();
        if (!tokens || !masterKeyBase64) {
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
          });

          if (savedAt) {
            set({ lastSyncedAt: savedAt });
          }
        } catch (error) {
          console.error("Vault yükleme hatası:", error);

          try {
            const snapshot = await readOfflineVaultSnapshot(masterKeyBase64);
            if (snapshot) {
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

          notify.error(getErrorMessage(error, "Kasa yüklenirken hata oluştu."));
          set({ isLoading: false });
        }
      },

      createVaultItem: async (data, folderId = null, favorite = false) => {
        const { masterKeyBase64 } = get();
        if (!masterKeyBase64) {
          return;
        }

        const masterKey = await importMasterKey(masterKeyBase64);
        const encrypted = await encryptJSON(data, masterKey);

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
        const { masterKeyBase64 } = get();
        if (!masterKeyBase64) {
          return;
        }

        const masterKey = await importMasterKey(masterKeyBase64);
        const encrypted = await encryptJSON(data, masterKey);

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

        get().updateItem(id, {
          data,
          folderId: response.data.folderId,
          updatedAt: response.data.updatedAt,
        });
      },

      loadAttachments: async (itemId) => {
        const { masterKeyBase64 } = get();
        if (!masterKeyBase64) {
          return;
        }

        const masterKey = await importMasterKey(masterKeyBase64);
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

        get().updateItem(itemId, { attachments });
      },

      uploadAttachment: async (itemId, file) => {
        const { masterKeyBase64 } = get();
        if (!masterKeyBase64) {
          return;
        }

        const masterKey = await importMasterKey(masterKeyBase64);
        const [metadata, encryptedFile] = await Promise.all([
          encryptJSON({ name: file.name, type: file.type || "application/octet-stream" }, masterKey),
          encryptBinary(await file.arrayBuffer(), masterKey),
        ]);

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
        get().updateItem(itemId, {
          attachments: [
            attachment,
            ...(get().items.find((item) => item.id === itemId)?.attachments ?? []),
          ],
        });
      },

      downloadAttachment: async (itemId, attachmentId) => {
        const { masterKeyBase64 } = get();
        if (!masterKeyBase64) {
          return;
        }

        const masterKey = await importMasterKey(masterKeyBase64);
        const response = (await get().runWithValidAccessToken((accessToken) =>
          api.vault.getAttachment(itemId, attachmentId, accessToken) as Promise<{ data: AttachmentResponse }>
        )) as { data: AttachmentResponse };

        const [metadata, data] = await Promise.all([
          decryptAttachmentMetadata(response.data, masterKey),
          decryptBinary(response.data.encryptedBlob, response.data.blobIv, masterKey),
        ]);

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
          writeSessionMasterKey(null);
          return set({
            isLocked: true,
            masterKeyBase64: null,
            items: [],
            folders: [],
            selectedFolderId: null,
            showFavoritesOnly: false,
          });
        },

      unlockVault: async (password, email) => {
        try {
          const masterKey = await deriveMasterKey(password, email);
          const keyBase64 = await exportMasterKeyBase64(masterKey);

          const verifierMatches = await verifyLockVerifier(keyBase64);
          const offlineSnapshot = verifierMatches
            ? null
            : await readOfflineVaultSnapshot(keyBase64);

          if (!verifierMatches && !offlineSnapshot) {
            return false;
          }

          await persistLockVerifier(keyBase64);
          writeSessionMasterKey(keyBase64);
          set({
            isLocked: false,
            masterKeyBase64: keyBase64,
            lastActivity: Date.now(),
          });
          await get().loadVault();
          return true;
        } catch {
          return false;
        }
      },

      unlockVaultLocally: async () => {
        try {
          const keyBase64 = await unlockWithLocalAuthenticator();
          const verifierMatches = await verifyLockVerifier(keyBase64);
          const offlineSnapshot = verifierMatches
            ? null
            : await readOfflineVaultSnapshot(keyBase64);

          if (!verifierMatches && !offlineSnapshot) {
            clearLocalUnlock();
            return false;
          }

          await persistLockVerifier(keyBase64);
          writeSessionMasterKey(keyBase64);
          set({
            isLocked: false,
            masterKeyBase64: keyBase64,
            lastActivity: Date.now(),
          });
          await get().loadVault();
          return true;
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
      version: 3,
      migrate: (persistedState: unknown) => {
        const state = (persistedState ?? {}) as Partial<AppStore>;

        return {
          ...state,
          currentDeviceId:
            typeof state.currentDeviceId === "string" ? state.currentDeviceId : null,
          masterKeyBase64:
            typeof state.masterKeyBase64 === "string" ? state.masterKeyBase64 : null,
          isLocked: state.isAuthenticated ? !state.masterKeyBase64 : false,
          showFavoritesOnly: false,
          sortBy: typeof state.sortBy === "string" ? state.sortBy : "updated-desc",
          viewMode:
            state.viewMode === "comfortable" ||
            state.viewMode === "compact" ||
            state.viewMode === "grid"
              ? state.viewMode
              : "comfortable",
          favoritesFirst:
            typeof state.favoritesFirst === "boolean" ? state.favoritesFirst : true,
        };
      },
      partialize: (state: AppStore) => ({
        isAuthenticated: state.isAuthenticated,
        tokens: state.tokens,
        userEmail: state.userEmail,
        userId: state.userId,
        currentDeviceId: state.currentDeviceId,
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
