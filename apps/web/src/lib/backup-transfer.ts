import { BACKUP_TRANSFER_CHUNK_BYTES, backupTransferSchema, backupTransferChunkSchema } from "@vaultmaster/shared";
import { arrayBufferToBase64, base64ToArrayBuffer } from "@vaultmaster/crypto";

// Retry only transport failures. Each retried mutation is immutable/idempotent.
export async function retryBackupTransfer<T>(operation: () => Promise<T>, guard: () => void): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    guard();
    try { const result = await operation(); guard(); return result; }
    catch (error) {
      guard();
      if (attempt >= 2 || !error || typeof error !== "object" || !("status" in error) || error.status !== 0) throw error;
    }
  }
}
export function encodeBackupTransfer(body: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  const manifest = backupTransferSchema.parse({ totalBytes: bytes.length, chunkCount: Math.ceil(bytes.length / BACKUP_TRANSFER_CHUNK_BYTES) });
  return { manifest, chunk: (index: number) => ({ index,
    data: arrayBufferToBase64(bytes.slice(index * BACKUP_TRANSFER_CHUNK_BYTES, (index + 1) * BACKUP_TRANSFER_CHUNK_BYTES).buffer) }) };
}
export async function decodeBackupTransfer<T>(manifest: unknown, read: (index: number) => Promise<unknown>, guard: () => void): Promise<T> {
  const parsed = backupTransferSchema.parse(manifest);
  const bytes = new Uint8Array(parsed.totalBytes);
  for (let index = 0; index < parsed.chunkCount; index++) {
    guard();
    const chunk = backupTransferChunkSchema.parse(await retryBackupTransfer(() => read(index), guard));
    const data = new Uint8Array(base64ToArrayBuffer(chunk.data));
    const expected = Math.min(BACKUP_TRANSFER_CHUNK_BYTES, parsed.totalBytes - index * BACKUP_TRANSFER_CHUNK_BYTES);
    if (chunk.index !== index || data.length !== expected) throw new Error("Invalid backup transfer chunk");
    bytes.set(data, index * BACKUP_TRANSFER_CHUNK_BYTES);
  }
  guard();
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as T;
}
