const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

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
  const { method = "GET", body, token } = options;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${endpoint}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(
      "API sunucusuna ulaşılamıyor. Backend servisinin çalıştığından emin olun.",
      0
    );
  }

  const data = await res
    .json()
    .catch(() => ({ error: "Sunucudan geçersiz yanıt alındı" }));

  if (!res.ok) {
    throw new ApiError(data.error || "Bir hata oluştu", res.status, {
      requestId: typeof data.requestId === "string" ? data.requestId : undefined,
      details: Array.isArray(data.details)
        ? data.details.filter((detail: unknown): detail is string => typeof detail === "string")
        : undefined,
    });
  }

  return data;
}

export const api = {
  auth: {
    register: (body: { email: string; authHash: string; kdfSalt: string; kdfIterations: number }) =>
      request("/auth/register", { method: "POST", body }),

    login: (body: {
      email: string;
      authHash: string;
      code?: string;
      recoveryCode?: string;
      webAuthnResponse?: unknown;
      webAuthnChallengeToken?: string;
    }) => request("/auth/login", { method: "POST", body }),

    refresh: (refreshToken: string) =>
      request("/auth/refresh", { method: "POST", body: { refreshToken } }),

    logout: (token: string, refreshToken: string) =>
      request("/auth/logout", { method: "POST", body: { refreshToken }, token }),

    me: (token: string) => request("/auth/me", { token }),

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
      body: {
        currentAuthHash: string;
        newAuthHash: string;
        kdfIterations: number;
        items: Array<{ id: string; encryptedData: string; iv: string }>;
      },
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
