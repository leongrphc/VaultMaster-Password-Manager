import { z } from "zod";
import { countBackup, MAX_BACKUP_FILE_BYTES, MAX_CHUNKED_SNAPSHOT_BYTES, personalSnapshotSchema,
  type PersonalSnapshot } from "@vaultmaster/shared";
import { decryptBackup, encryptChunkedBackup, decryptChunkedBackup, MAX_CHUNKED_BACKUP_FILE_BYTES, decryptBinary, encryptBinary, decryptJSON, encryptJSON, importMasterKey } from "@vaultmaster/crypto";

export const backupArchiveSchema = z.object({
  scope: z.literal("personal-vault"), backupId: z.string().uuid(), exportedAt: z.string().datetime(),
  sourceEmail: z.string().email(), vaultKeyBase64: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
  snapshot: personalSnapshotSchema,
}).strict();
export type BackupArchive = z.infer<typeof backupArchiveSchema>;

async function transformSnapshot(snapshot: PersonalSnapshot, sourceKey: CryptoKey, targetKey: CryptoKey | null, assertCurrent: () => void) {
  const output: PersonalSnapshot = { folders: snapshot.folders.map(folder => ({ ...folder })), items: [] };
  const transform = async (ciphertext: string, iv: string) => {
    assertCurrent();
    const data = await decryptJSON(ciphertext, iv, sourceKey);
    assertCurrent();
    if (!targetKey) return { encryptedData: ciphertext, iv };
    const encrypted = await encryptJSON(data, targetKey);
    return { encryptedData: encrypted.ciphertext, iv: encrypted.iv };
  };
  for (const item of snapshot.items) {
    const transformed = { ...item, ...await transform(item.encryptedData, item.iv), versions: [...item.versions], attachments: [...item.attachments] };
    for (let index = 0; index < item.versions.length; index++) {
      const version = item.versions[index]!;
      transformed.versions[index] = { ...version, ...await transform(version.encryptedData, version.iv) };
    }
    for (let index = 0; index < item.attachments.length; index++) {
      const file = item.attachments[index]!;
      const metadata = await transform(file.encryptedMetadata, file.metadataIv);
      assertCurrent();
      const bytes = await decryptBinary(file.encryptedBlob, file.blobIv, sourceKey);
      if (bytes.byteLength !== file.size) throw new Error("Yedekteki ek boyutu doğrulanamadı.");
      assertCurrent();
      const blob = targetKey ? await encryptBinary(bytes, targetKey) : { ciphertext: file.encryptedBlob, iv: file.blobIv };
      transformed.attachments[index] = { ...file, encryptedMetadata: metadata.encryptedData, metadataIv: metadata.iv,
        encryptedBlob: blob.ciphertext, blobIv: blob.iv };
    }
    output.items.push(transformed);
  }
  assertCurrent();
  return output;
}

export async function createFullBackup(archive: BackupArchive, password: string, assertCurrent: () => void): Promise<string> {
  const parsed = backupArchiveSchema.parse(archive);
  if (new TextEncoder().encode(JSON.stringify(parsed.snapshot)).byteLength > MAX_CHUNKED_SNAPSHOT_BYTES) throw new Error("Kasa yedek boyut sınırını aşıyor.");
  // Verify every encrypted record, including historical data, before claiming
  // that the archive is restorable. Never silently omit unreadable content.
  await transformSnapshot(parsed.snapshot, await importMasterKey(parsed.vaultKeyBase64), null, assertCurrent);
  const file = JSON.stringify(await encryptChunkedBackup(parsed, password, assertCurrent));
  assertCurrent();
  if (new TextEncoder().encode(file).byteLength > MAX_CHUNKED_BACKUP_FILE_BYTES) throw new Error("Yedek dosyası boyut sınırını aşıyor.");
  return file;
}

export async function openFullBackup(text: string, password: string): Promise<BackupArchive> {
  if (new TextEncoder().encode(text).byteLength > MAX_CHUNKED_BACKUP_FILE_BYTES) throw new Error("Yedek dosyası 90 MiB sınırını aşıyor.");
  let archive: BackupArchive;
  try {
    const file = JSON.parse(text);
    if (file.version === 3 && new TextEncoder().encode(text).byteLength > MAX_BACKUP_FILE_BYTES) throw new Error("Legacy size limit");
    archive = backupArchiveSchema.parse(await (file.version === 4 ? decryptChunkedBackup(file, password) : decryptBackup(file, password)));
  }
  catch { throw new Error("Yedek açılamadı. Yedek şifresini ve dosyanın bütünlüğünü kontrol edin."); }
  if (new TextEncoder().encode(JSON.stringify(archive.snapshot)).byteLength > MAX_CHUNKED_SNAPSHOT_BYTES) throw new Error("Kasa yedek boyut sınırını aşıyor.");
  await transformSnapshot(archive.snapshot, await importMasterKey(archive.vaultKeyBase64), null, () => undefined);
  return archive;
}

export async function prepareBackupRestore(archive: BackupArchive, targetKeyBase64: string, assertCurrent: () => void) {
  const parsed = backupArchiveSchema.parse(archive);
  const snapshot = await transformSnapshot(parsed.snapshot, await importMasterKey(parsed.vaultKeyBase64),
    await importMasterKey(targetKeyBase64), assertCurrent);
  const body = { backupId: parsed.backupId, snapshot };
  if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > MAX_CHUNKED_SNAPSHOT_BYTES) throw new Error("Yedek geri yükleme boyut sınırını aşıyor.");
  return body;
}
export { countBackup };
