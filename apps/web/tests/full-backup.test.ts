import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createVaultKey, exportMasterKeyBase64, encryptJSON, decryptJSON, encryptBinary, decryptBinary, encryptBackup } from "@vaultmaster/crypto";
import { createFullBackup, openFullBackup, prepareBackupRestore, type BackupArchive } from "../src/lib/full-backup";

beforeEach(() => vi.stubGlobal("crypto", webcrypto));
afterEach(() => vi.unstubAllGlobals());
const date = "2026-10-05T00:00:00.000Z";
async function fixture() {
  const key = await createVaultKey();
  const keyBase64 = await exportMasterKeyBase64(key);
  const folderId = crypto.randomUUID();
  const payload = { type: "login", title: "Fixture", password: "backup-only-secret" };
  const data = await encryptJSON(payload, key);
  const blob = await encryptBinary(new Uint8Array([0, 1, 255]).buffer, key);
  const archive: BackupArchive = { scope: "personal-vault", backupId: crypto.randomUUID(), exportedAt: date,
    sourceEmail: "source@example.test", vaultKeyBase64: keyBase64,
    snapshot: { folders: [{ id: folderId, name: "Private folder", createdAt: date, updatedAt: date }], items: [
      { id: crypto.randomUUID(), encryptedData: data.ciphertext, iv: data.iv, folderId, favorite: true, deletedAt: date,
        createdAt: date, updatedAt: date,
        versions: [{ id: crypto.randomUUID(), encryptedData: data.ciphertext, iv: data.iv, folderId: crypto.randomUUID(), favorite: false, reason: "update", createdAt: date }],
        attachments: [{ id: crypto.randomUUID(), encryptedMetadata: data.ciphertext, metadataIv: data.iv,
          encryptedBlob: blob.ciphertext, blobIv: blob.iv, size: 3, createdAt: date, updatedAt: date }] },
    ] } };
  return { archive, key, keyBase64, payload };
}

test("portable full backup survives source-account loss and re-encrypts history, trash and files for a different key", async () => {
  const { archive, keyBase64, payload } = await fixture();
  const file = await createFullBackup(archive, "independent-backup-password", () => undefined);
  expect(file).not.toContain(keyBase64);
  expect(file).not.toContain("backup-only-secret");
  expect(file).not.toContain("Private folder");
  expect(file).not.toContain(archive.sourceEmail);
  const recovered = await openFullBackup(file, "independent-backup-password");
  expect(recovered).toEqual(archive);
  const targetKey = await createVaultKey();
  const restored = await prepareBackupRestore(recovered, await exportMasterKeyBase64(targetKey), () => undefined);
  expect(restored).not.toHaveProperty("vaultKeyBase64");
  expect(JSON.stringify(restored)).not.toContain(keyBase64);
  const item = restored.snapshot.items[0]!;
  expect(item.deletedAt).toBe(date);
  expect(item.createdAt).toBe(date);
  expect(item.versions[0]!.folderId).toBe(archive.snapshot.items[0]!.versions[0]!.folderId);
  expect(await decryptJSON(item.encryptedData, item.iv, targetKey)).toEqual(payload);
  const version = item.versions[0]!;
  expect(await decryptJSON(version.encryptedData, version.iv, targetKey)).toEqual(payload);
  const attachment = item.attachments[0]!;
  expect(await decryptJSON(attachment.encryptedMetadata, attachment.metadataIv, targetKey)).toEqual(payload);
  expect(new Uint8Array(await decryptBinary(attachment.encryptedBlob, attachment.blobIv, targetKey))).toEqual(new Uint8Array([0, 1, 255]));
  expect(archive.snapshot.items[0]!.encryptedData).not.toBe(item.encryptedData);
});

test("wrong passwords, tampering, unsupported versions and malicious KDF work factors fail before restore", async () => {
  const { archive } = await fixture();
  const file = await createFullBackup(archive, "independent-backup-password", () => undefined);
  await expect(openFullBackup(file, "wrong-password")).rejects.toThrow();
  const parsed = JSON.parse(file);
  parsed.kdf.iterations = 2000000000;
  await expect(openFullBackup(JSON.stringify(parsed), "independent-backup-password")).rejects.toThrow();
  parsed.kdf.iterations = 600000;
  parsed.chunks[0].ciphertext = (parsed.chunks[0].ciphertext[0] === "A" ? "B" : "A") + parsed.chunks[0].ciphertext.slice(1);
  await expect(openFullBackup(JSON.stringify(parsed), "independent-backup-password")).rejects.toThrow();
  parsed.version = 99;
  await expect(openFullBackup(JSON.stringify(parsed), "independent-backup-password")).rejects.toThrow();
});

test("unreadable history and mismatched attachment sizes block the entire export", async () => {
  const { archive } = await fixture();
  archive.snapshot.items[0]!.attachments[0]!.size = 4;
  await expect(createFullBackup(archive, "independent-backup-password", () => undefined)).rejects.toThrow();
  archive.snapshot.items[0]!.attachments[0]!.size = 3;
  archive.snapshot.items[0]!.versions[0]!.encryptedData = "broken";
  await expect(createFullBackup(archive, "independent-backup-password", () => undefined)).rejects.toThrow();
});

test("session invalidation aborts encrypted preparation before any request or download", async () => {
  const { archive } = await fixture();
  let operations = 0;
  const guard = () => { if (++operations > 2) throw new Error("Session locked"); };
  await expect(prepareBackupRestore(archive, archive.vaultKeyBase64, guard)).rejects.toThrow("Session locked");
});


test("version 3 archives still open and restore all personal content", async () => {
  const { archive } = await fixture();
  const file = JSON.stringify(await encryptBackup(archive, "independent-backup-password"));
  expect(await openFullBackup(file, "independent-backup-password")).toEqual(archive);
  const target = await createVaultKey();
  const restored = await prepareBackupRestore(await openFullBackup(file, "independent-backup-password"), await exportMasterKeyBase64(target), () => undefined);
  expect(await decryptJSON(restored.snapshot.items[0]!.encryptedData, restored.snapshot.items[0]!.iv, target)).toEqual((await fixture()).payload);
});
