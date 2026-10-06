"use client";

import { decryptJSON, encryptJSON, importMasterKey } from "@vaultmaster/crypto";
import type { FolderResponse, VaultItemData } from "@vaultmaster/shared";

export interface OfflineVaultItem {
  id: string;
  folderId: string | null;
  favorite: boolean;
  data: VaultItemData;
  createdAt: string;
  updatedAt: string;
}

export interface OfflineVaultSnapshot {
  savedAt: string;
  items: OfflineVaultItem[];
  folders: FolderResponse[];
}

const OFFLINE_SNAPSHOT_KEY = "vaultmaster-offline-snapshot";
// Opaque, non-secret generation invalidates encryption started before cleanup.
const SNAPSHOT_GENERATION_KEY = "vaultmaster-offline-snapshot-generation";
const LOCK_VERIFIER_KEY = "vaultmaster-lock-verifier";
const LOCK_VERIFIER_MARKER = "vaultmaster-lock-verifier";

export async function persistOfflineVaultSnapshot(params: {
  items: OfflineVaultItem[];
  folders: FolderResponse[];
  masterKeyBase64: string | null;
  isCurrent?: () => boolean;
}): Promise<string | null> {
  const { items, folders, masterKeyBase64 } = params;
  if (!masterKeyBase64 || typeof window === "undefined") {
    return null;
  }

  const generation = localStorage.getItem(SNAPSHOT_GENERATION_KEY);
  const savedAt = new Date().toISOString();
  const masterKey = await importMasterKey(masterKeyBase64);
  const encrypted = await encryptJSON(
    {
      savedAt,
      items,
      folders,
    },
    masterKey
  );

  if (params.isCurrent && !params.isCurrent()) return null;
  if (localStorage.getItem(SNAPSHOT_GENERATION_KEY) !== generation) return null;
  localStorage.setItem(
    OFFLINE_SNAPSHOT_KEY,
    JSON.stringify({
      version: 1,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
    })
  );

  return savedAt;
}

export async function persistLockVerifier(
  masterKeyBase64: string | null,
  isCurrent?: () => boolean
): Promise<boolean> {
  if (!masterKeyBase64 || typeof window === "undefined") {
    return false;
  }

  const masterKey = await importMasterKey(masterKeyBase64);
  const encrypted = await encryptJSON(
    {
      marker: LOCK_VERIFIER_MARKER,
      createdAt: new Date().toISOString(),
    },
    masterKey
  );

  if (isCurrent && !isCurrent()) return false;
  localStorage.setItem(
    LOCK_VERIFIER_KEY,
    JSON.stringify({
      version: 1,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
    })
  );

  return true;
}

export async function verifyLockVerifier(
  masterKeyBase64: string | null
): Promise<boolean> {
  if (!masterKeyBase64 || typeof window === "undefined") {
    return false;
  }

  const raw = localStorage.getItem(LOCK_VERIFIER_KEY);
  if (!raw) {
    return false;
  }

  const parsed = JSON.parse(raw) as {
    ciphertext?: string;
    iv?: string;
  };

  if (!parsed.ciphertext || !parsed.iv) {
    return false;
  }

  try {
    const masterKey = await importMasterKey(masterKeyBase64);
    const decrypted = await decryptJSON<{ marker?: string }>(
      parsed.ciphertext,
      parsed.iv,
      masterKey
    );

    return decrypted.marker === LOCK_VERIFIER_MARKER;
  } catch {
    return false;
  }
}

export async function readOfflineVaultSnapshot(
  masterKeyBase64: string | null
): Promise<OfflineVaultSnapshot | null> {
  if (!masterKeyBase64 || typeof window === "undefined") {
    return null;
  }

  const raw = localStorage.getItem(OFFLINE_SNAPSHOT_KEY);
  if (!raw) {
    return null;
  }

  const parsed = JSON.parse(raw) as {
    ciphertext?: string;
    iv?: string;
  };

  if (!parsed.ciphertext || !parsed.iv) {
    return null;
  }

  const masterKey = await importMasterKey(masterKeyBase64);
  return decryptJSON<OfflineVaultSnapshot>(
    parsed.ciphertext,
    parsed.iv,
    masterKey
  );
}

export function clearOfflineVaultSnapshot() {
  if (typeof window === "undefined") {
    return;
  }

  localStorage.removeItem(OFFLINE_SNAPSHOT_KEY);
}

export function clearLockVerifier() {
  if (typeof window === "undefined") {
    return;
  }

  localStorage.removeItem(LOCK_VERIFIER_KEY);
}

/** Presence only: never decrypt or expose snapshot content in cleanup UI. */
export function hasOfflineVaultSnapshot(): boolean {
  return typeof window !== "undefined" && localStorage.getItem(OFFLINE_SNAPSHOT_KEY) !== null;
}

/** Only the encrypted local snapshot is removable here; no bulk storage deletion. */
export function removeOfflineSnapshotForCleanup(): void {
  if (typeof window === "undefined") return;
  // Write first: if storage is unavailable, fail without reporting success.
  localStorage.setItem(SNAPSHOT_GENERATION_KEY, crypto.randomUUID());
  clearOfflineVaultSnapshot();
}
