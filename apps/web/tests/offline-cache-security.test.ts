import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { deriveMasterKey, exportMasterKeyBase64 } from "@vaultmaster/crypto";
import { persistLockVerifier, persistOfflineVaultSnapshot, readOfflineVaultSnapshot, verifyLockVerifier } from "../src/lib/offline-cache";

beforeEach(() => { localStorage.clear(); vi.stubGlobal("crypto", webcrypto); });
afterEach(() => vi.unstubAllGlobals());
async function key() {
  return exportMasterKeyBase64(await deriveMasterKey("fixture-password", "fixture@example.test", 1));
}

test("stores encrypted snapshots without the plaintext password or key", async () => {
  const masterKeyBase64 = await key();
  const items = [{ id: "item-1", folderId: null, favorite: false, createdAt: "2026-10-05", updatedAt: "2026-10-05", data: { type: "login" as const, title: "Fixture", username: "octo", password: "fixture-secret" } }];
  await persistLockVerifier(masterKeyBase64);
  await persistOfflineVaultSnapshot({ items, folders: [], masterKeyBase64, isCurrent: () => true });
  const stored = JSON.stringify(Object.values(localStorage));
  expect(stored).not.toContain(masterKeyBase64);
  expect(stored).not.toContain("fixture-secret");
  expect(await verifyLockVerifier(masterKeyBase64)).toBe(true);
  expect((await readOfflineVaultSnapshot(masterKeyBase64))?.items).toEqual(items);
});

test("discards encrypted results from a session invalidated during encryption", async () => {
  const masterKeyBase64 = await key();
  expect(await persistLockVerifier(masterKeyBase64, () => false)).toBe(false);
  expect(await persistOfflineVaultSnapshot({ items: [], folders: [], masterKeyBase64, isCurrent: () => false })).toBeNull();
  expect(localStorage.length).toBe(0);
});
