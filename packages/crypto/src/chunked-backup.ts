import { backupKey } from "./backup.js";
import { arrayBufferToBase64, base64ToArrayBuffer } from "./utils.js";

export const BACKUP_CHUNK_BYTES = 1024 * 1024;
export const MAX_CHUNKED_BACKUP_BYTES = 65 * 1024 * 1024;
export const MAX_CHUNKED_BACKUP_FILE_BYTES = 90 * 1024 * 1024;
export interface ChunkedBackup {
  format: "vaultmaster-personal-backup";
  version: 4;
  kdf: { name: "PBKDF2-SHA256"; iterations: 600000; salt: string };
  chunkBytes: number;
  totalBytes: number;
  chunkCount: number;
  chunks: { index: number; iv: string; ciphertext: string }[];
}
const encoder = new TextEncoder();
function aad(header: Omit<ChunkedBackup, "chunks">, index: number) {
  return encoder.encode(JSON.stringify({ ...header, index }));
}
export async function encryptChunkedBackup(payload: unknown, password: string, guard = () => {}) : Promise<ChunkedBackup> {
  if (password.length < 12) throw new Error("Yedek şifresi en az 12 karakter olmalı.");
  const bytes = encoder.encode(JSON.stringify(payload));
  if (bytes.length > MAX_CHUNKED_BACKUP_BYTES) throw new Error("Backup size limit exceeded");
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const header: Omit<ChunkedBackup, "chunks"> = { format: "vaultmaster-personal-backup", version: 4,
    kdf: { name: "PBKDF2-SHA256", iterations: 600000, salt: arrayBufferToBase64(salt.buffer) },
    chunkBytes: BACKUP_CHUNK_BYTES, totalBytes: bytes.length, chunkCount: Math.ceil(bytes.length / BACKUP_CHUNK_BYTES) };
  const key = await backupKey(password, salt.buffer);
  const chunks: ChunkedBackup["chunks"] = [];
  for (let index = 0; index < header.chunkCount; index++) {
    guard();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(header, index), tagLength: 128 },
      key, bytes.slice(index * BACKUP_CHUNK_BYTES, (index + 1) * BACKUP_CHUNK_BYTES));
    guard();
    chunks.push({ index, iv: arrayBufferToBase64(iv.buffer), ciphertext: arrayBufferToBase64(ciphertext) });
  }
  return { ...header, chunks };
}
export async function decryptChunkedBackup<T>(input: unknown, password: string): Promise<T> {
  const file = input as ChunkedBackup | null;
  if (!file || file.format !== "vaultmaster-personal-backup" || file.version !== 4 ||
      file.kdf?.name !== "PBKDF2-SHA256" || file.kdf.iterations !== 600000 || typeof file.kdf.salt !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(file.kdf.salt) ||
      file.chunkBytes !== BACKUP_CHUNK_BYTES || !Number.isSafeInteger(file.totalBytes) || file.totalBytes < 1 ||
      file.totalBytes > MAX_CHUNKED_BACKUP_BYTES || file.chunkCount !== Math.ceil(file.totalBytes / BACKUP_CHUNK_BYTES) ||
      !Array.isArray(file.chunks) || file.chunks.length !== file.chunkCount) throw new Error("Invalid chunked backup header");
  const salt = base64ToArrayBuffer(file.kdf.salt);
  if (salt.byteLength !== 32) throw new Error("Invalid salt");
  const header: Omit<ChunkedBackup, "chunks"> = { format: file.format, version: file.version,
    kdf: { name: file.kdf.name, iterations: file.kdf.iterations, salt: file.kdf.salt },
    chunkBytes: file.chunkBytes, totalBytes: file.totalBytes, chunkCount: file.chunkCount };
  // Validate every bound and position before allocation or password derivation.
  for (let index = 0; index < file.chunkCount; index++) {
    const chunk = file.chunks[index];
    const length = Math.min(BACKUP_CHUNK_BYTES, file.totalBytes - index * BACKUP_CHUNK_BYTES);
    if (!chunk || chunk.index !== index || typeof chunk.iv !== "string" || chunk.iv.length !== 16 ||
        typeof chunk.ciphertext !== "string" || chunk.ciphertext.length !== 4 * Math.ceil((length + 16) / 3))
      throw new Error("Invalid chunk order or size");
  }
  const key = await backupKey(password, salt);
  const bytes = new Uint8Array(file.totalBytes);
  for (let index = 0; index < file.chunkCount; index++) {
    const chunk = file.chunks[index]!;
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToArrayBuffer(chunk.iv),
      additionalData: aad(header, index), tagLength: 128 }, key, base64ToArrayBuffer(chunk.ciphertext));
    const length = Math.min(BACKUP_CHUNK_BYTES, file.totalBytes - index * BACKUP_CHUNK_BYTES);
    if (plaintext.byteLength !== length) throw new Error("Invalid chunk length");
    bytes.set(new Uint8Array(plaintext), index * BACKUP_CHUNK_BYTES);
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as T;
}
