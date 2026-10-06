import { observe } from "./observability";
import { sensitiveAction } from "@vaultmaster/shared";
import { requestReauthentication } from "./reauthentication";
import { encodeBackupTransfer, decodeBackupTransfer, retryBackupTransfer } from "./backup-transfer";
import type { PasswordChangeInput, RegisterInput, VaultKeyEnvelope, RestoreBackupInput, PersonalSnapshot, BackupCounts } from "@vaultmaster/shared";
const API_BASE = "/api";

interface ApiErrorOptions {
  requestId?: string;
  details?: string[];
}

export class ApiError extends Error {
  status: number;
  requestId?: string;
  details?: string[];

  constructor(message: string, status: number, options: ApiErrorOptions = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.requestId = options.requestId;
    this.details = options.details;
  }
}

export function isUnauthorizedError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 401;
}

export function getErrorMessage(error: unknown, fallback = "Bir hata oluştu"): string {
  if (error instanceof ApiError) {
    if (error.requestId) {
      return `${error.message} (İstek No: ${error.requestId})`;
    }

    return error.message;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  token?: string;
}

async function request<T>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> {
  const { method = "GET", body } = options;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-VaultMaster-Client": "web",
  };

  const path = endpoint.split("?")[0];
  if (sensitiveAction(method, path)) {
    // Capture the unlocking session before opening a dialog. No proof survives
    // lock/logout/account changes and no rejected operation is automatically replayed.
    const { useStore } = await import("./store");
    const guard = useStore.getState().getVaultOperationGuard();
    guard();
    const input = body as { currentAuthHash?: string; authHash?: string } | undefined;
    headers["X-VaultMaster-Reauth"] = await requestReauthentication({ method, path, authHash: input?.currentAuthHash ?? input?.authHash });
    guard();
  }

  const operation = endpoint.startsWith("/backups") ? "backup" :
    endpoint.startsWith("/vault") || endpoint.startsWith("/folders") ? "sync" : "api";
  const event = operation === "backup" ? "backup_result" : operation === "sync" ? "sync_result" : "http_request";
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${endpoint}`, {
      method,
      credentials: "same-origin",
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    observe(event, { operation, outcome: "failure", reason: "network" });
    throw new ApiError(
      "API sunucusuna ulaşılamıyor. Backend servisinin çalıştığından emin olun.",
      0
    );
  }

  const data = await res.json().catch(() => {
    observe(event, { operation, outcome: "failure", reason: "invalid_response" });
    throw new ApiError("Sunucudan geçersiz yanıt alındı", res.status);
  });
  observe(event, { operation, outcome: res.ok ? "success" : "failure", statusCode: res.status, ...(!res.ok ? { reason: "http" } : {}) });

  if (!res.ok) {
    throw new ApiError(data.error || "Bir hata oluştu", res.status, {
      details: Array.isArray(data.details)
        ? data.details.filter((detail: unknown): detail is string => typeof detail === "string")
        : undefined,
    });
  }

  return data;
}

async function mutateSession<T>(operation: () => Promise<T>): Promise<T> {
  return typeof navigator !== "undefined" && navigator.locks
    ? navigator.locks.request("vaultmaster-cookie-refresh", operation) : operation();
}

export const api = {
  exchange: {
    call: <T>(path: string, method = "GET", body?: unknown) => request<{ data: T }>(`/key-exchange${path}`, { method, body }),
  },
  backups: {
    importState: (token: string) => request<{ data: import("./import-conflicts").ImportState }>("/backups/import-state", { token }),
    snapshot: async (token: string, guard = () => {}) => {
      guard();
      const response = await request<{ data: { transferId: string; totalBytes: number; chunkCount: number } }>("/backups/snapshot?version=4", { token });
      const manifest = response.data;
      try {
        const data = await decodeBackupTransfer<{ backupId: string; exportedAt: string; sourceEmail: string; snapshot: PersonalSnapshot }>(
          { totalBytes: manifest.totalBytes, chunkCount: manifest.chunkCount },
          async index => (await request<{ data: unknown }>(`/backups/transfers/${manifest.transferId}/chunks/${index}`, { token })).data, guard);
        return { data };
      } finally { await request(`/backups/transfers/${manifest.transferId}`, { method: "DELETE", token }).catch(() => undefined); }
    },
    restore: async (body: RestoreBackupInput, token: string, guard = () => {}) => {
      guard();
      const encoded = encodeBackupTransfer(body);
      const response = await request<{ data: { transferId: string } }>("/backups/transfers", { method: "POST", body: encoded.manifest, token });
      const endpoint = `/backups/transfers/${response.data.transferId}`;
      try {
        for (let index = 0; index < encoded.manifest.chunkCount; index++) {
          await retryBackupTransfer(() => request(`${endpoint}/chunks`, { method: "PUT", body: encoded.chunk(index), token }), guard);
        }
        const result = await retryBackupTransfer(() => request<{ data: { alreadyRestored: boolean; counts: BackupCounts } }>(
          `${endpoint}/commit`, { method: "POST", token }), guard);
        return result;
      } finally {
        // Once retries end, discard staging; failed cleanup is bounded by expiry.
        await request(endpoint, { method: "DELETE", token }).catch(() => undefined);
      }
    },
  },
  auth: {
    reauthenticate: (body: { method: string; path: string; authHash: string; code?: string; recoveryCode?: string; webAuthnResponse?: unknown; webAuthnChallengeToken?: string }, token: string) =>
      request<{ data: { proof?: string; requires2FA?: boolean; webAuthnOptions?: { options: import("@simplewebauthn/browser").PublicKeyCredentialRequestOptionsJSON; challengeToken: string } } }>("/auth/reauthenticate", { method: "POST", body, token }),
    authorizeExport: (token: string) => request("/auth/export-authorize", { method: "POST", token }),
    securityNotifications: (token: string) => request<{ data: SecurityNotification[] }>("/auth/security-notifications", { token }),
    readSecurityNotification: (id: string, token: string) => request(`/auth/security-notifications/${encodeURIComponent(id)}/read`, { method: "POST", token }),
    register: (body: RegisterInput) =>
      mutateSession(() => request("/auth/register", { method: "POST", body })),

    login: (body: {
      vaultKeyProtocol: 1;
      email: string;
      authHash: string;
      code?: string;
      recoveryCode?: string;
      webAuthnResponse?: unknown;
      webAuthnChallengeToken?: string;
    }) => mutateSession(() => request("/auth/login", { method: "POST", body })),

    refresh: () => request("/auth/refresh", { method: "POST" }),

    logout: (token?: string, refreshToken?: string) => {
      void token; void refreshToken; // Compatibility for callers; credentials stay in cookies.
      return mutateSession(() => request("/auth/logout", { method: "POST" }));
    },

    me: (token: string) => request("/auth/me", { token }),
    getVaultKey: (token: string) => request<{ data: { vaultKeyEnvelope: VaultKeyEnvelope | null } }>("/auth/vault-key", { token }),

    twoFactorSetup: (token: string) =>
      request("/auth/2fa/setup", { method: "POST", token }),

    twoFactorVerify: (body: { code: string }, token: string) =>
      request("/auth/2fa/verify", { method: "POST", body, token }),

    twoFactorDisable: (body: { code?: string; recoveryCode?: string }, token: string) =>
      request("/auth/2fa/disable", { method: "POST", body, token }),

    twoFactorStatus: (token: string) => request("/auth/2fa/status", { token }),

    regenerateRecoveryCodes: (
      body: { code?: string; recoveryCode?: string },
      token: string
    ) => request("/auth/2fa/recovery-codes/regenerate", { method: "POST", body, token }),

    webAuthnCredentials: (token: string) =>
      request("/auth/webauthn/credentials", { token }),

    webAuthnRegistrationOptions: (token: string) =>
      request("/auth/webauthn/registration/options", { method: "POST", token }),

    webAuthnRegistrationVerify: (
      body: { response: unknown; challengeToken: string; name?: string },
      token: string
    ) => request("/auth/webauthn/registration/verify", { method: "POST", body, token }),

    webAuthnRename: (id: string, body: { name: string }, token: string) =>
      request(`/auth/webauthn/credentials/${id}`, { method: "PATCH", body, token }),

    webAuthnRemove: (id: string, token: string) =>
      request(`/auth/webauthn/credentials/${id}`, { method: "DELETE", token }),

    changePassword: (
      body: PasswordChangeInput,
      token: string
    ) => request("/auth/change-password", { method: "POST", body, token }),

    deleteAccount: (
      body: { authHash: string; code?: string; recoveryCode?: string },
      token: string
    ) => request("/auth/delete-account", { method: "POST", body, token }),
  },

  sharedVaults: {
    getAll: (token: string) => request("/shared-vaults", { token }),

    create: (
      body: {
        encryptedMetadata: string;
        metadataIv: string;
        encryptedVaultKey: string;
        encryptedVaultKeyIv: string;
      },
      token: string
    ) => request("/shared-vaults", { method: "POST", body, token }),

    getMembers: (id: string, token: string) =>
      request(`/shared-vaults/${id}/members`, { token }),

    invite: (
      id: string,
      body: {
        email: string;
        role: "viewer" | "editor" | "admin";
        encryptedVaultKey: string;
        encryptedVaultKeyIv: string;
      },
      token: string
    ) => request(`/shared-vaults/${id}/invite`, { method: "POST", body, token }),

    removeMember: (id: string, memberId: string, token: string) =>
      request(`/shared-vaults/${id}/members/${memberId}`, { method: "DELETE", token }),

    getItems: (id: string, token: string) =>
      request(`/shared-vaults/${id}/items`, { token }),

    createItem: (
      id: string,
      body: { encryptedData: string; iv: string; favorite?: boolean },
      token: string
    ) => request(`/shared-vaults/${id}/items`, { method: "POST", body, token }),

    updateItem: (
      id: string,
      itemId: string,
      body: { encryptedData?: string; iv?: string; favorite?: boolean },
      token: string
    ) => request(`/shared-vaults/${id}/items/${itemId}`, { method: "PUT", body, token }),

    deleteItem: (id: string, itemId: string, token: string) =>
      request(`/shared-vaults/${id}/items/${itemId}`, { method: "DELETE", token }),
  },

  emergencyAccess: {
    getAll: (token: string) => request("/emergency-access", { token }),

    invite: (
      body: {
        contactEmail: string;
        encryptedAccessKey: string;
        encryptedAccessIv: string;
        waitTimeDays: number;
      },
      token: string
    ) => request("/emergency-access", { method: "POST", body, token }),

    accept: (id: string, token: string) =>
      request(`/emergency-access/${id}/accept`, { method: "POST", token }),

    request: (id: string, token: string) =>
      request(`/emergency-access/${id}/request`, { method: "POST", token }),

    approve: (id: string, token: string) =>
      request(`/emergency-access/${id}/approve`, { method: "POST", token }),

    reject: (id: string, token: string) =>
      request(`/emergency-access/${id}/reject`, { method: "POST", token }),

    cancel: (id: string, token: string) =>
      request(`/emergency-access/${id}/cancel`, { method: "POST", token }),

    release: (id: string, token: string) =>
      request(`/emergency-access/${id}/release`, { token }),
  },

  vault: {
    getAll: (token: string) => request("/vault", { token }),

    getTrash: (token: string) => request("/vault/trash", { token }),

    getById: (id: string, token: string) => request(`/vault/${id}`, { token }),

    getHistory: (id: string, token: string) => request(`/vault/${id}/history`, { token }),

    getAttachments: (id: string, token: string) =>
      request(`/vault/${id}/attachments`, { token }),

    createAttachment: (
      id: string,
      body: {
        encryptedMetadata: string;
        metadataIv: string;
        encryptedBlob: string;
        blobIv: string;
        size: number;
      },
      token: string
    ) => request(`/vault/${id}/attachments`, { method: "POST", body, token }),

    getAttachment: (id: string, attachmentId: string, token: string) =>
      request(`/vault/${id}/attachments/${attachmentId}`, { token }),

    deleteAttachment: (id: string, attachmentId: string, token: string) =>
      request(`/vault/${id}/attachments/${attachmentId}`, { method: "DELETE", token }),

    create: (
      body: { encryptedData: string; iv: string; folderId?: string | null; favorite?: boolean },
      token: string
    ) => request("/vault", { method: "POST", body, token }),

    update: (
      id: string,
      body: { encryptedData?: string; iv?: string; folderId?: string | null; favorite?: boolean },
      token: string
    ) => request(`/vault/${id}`, { method: "PUT", body, token }),

    delete: (id: string, token: string) =>
      request(`/vault/${id}`, { method: "DELETE", token }),

    restore: (id: string, token: string) =>
      request(`/vault/${id}/restore`, { method: "POST", token }),

    restoreVersion: (id: string, versionId: string, token: string) =>
      request(`/vault/${id}/history/${versionId}/restore`, { method: "POST", token }),

    purge: (id: string, token: string) =>
      request(`/vault/${id}/purge`, { method: "DELETE", token }),
  },

  folders: {
    getAll: (token: string) => request("/folders", { token }),

    create: (body: { name: string }, token: string) =>
      request("/folders", { method: "POST", body, token }),

    update: (id: string, body: { name: string }, token: string) =>
      request(`/folders/${id}`, { method: "PUT", body, token }),

    delete: (id: string, token: string) =>
      request(`/folders/${id}`, { method: "DELETE", token }),
  },

  devices: {
    getAll: (token: string) => request("/devices", { token }),

    update: (id: string, body: { deviceName: string }, token: string) =>
      request(`/devices/${id}`, { method: "PATCH", body, token }),

    revokeOthers: (currentDeviceId: string, token: string) =>
      request("/devices/revoke-others", {
        method: "POST",
        body: { currentDeviceId },
        token,
      }),

    revoke: (id: string, token: string) =>
      request(`/devices/${id}`, { method: "DELETE", token }),
  },

  auditEvents: {
    getAll: (token: string, limit = 20) =>
      request(`/audit-events?limit=${limit}`, { token }),
  },
};

export interface SecurityNotification { id: string; action: string; message: string; createdAt: string; readAt: string | null }
