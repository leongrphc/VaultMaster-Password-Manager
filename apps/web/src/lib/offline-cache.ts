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
const LOCK_VERIFIER_KEY = "vaultmaster-lock-verifier";
const LOCK_VERIFIER_MARKER = "vaultmaster-lock-verifier";

export async function persistOfflineVaultSnapshot(params: {
  items: OfflineVaultItem[];
  folders: FolderResponse[];
  masterKeyBase64: string | null;
}): Promise<string | null> {
  const { items, folders, masterKeyBase64 } = params;
  if (!masterKeyBase64 || typeof window === "undefined") {
    return null;
  }

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
  masterKeyBase64: string | null
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
