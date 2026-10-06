import { arrayBufferToBase64, base64ToArrayBuffer } from "./utils.js";

const ITERATIONS = 600_000;
export interface EncryptedBackup {
  format: "vaultmaster-personal-backup";
  version: 3;
  kdf: { name: "PBKDF2-SHA256"; iterations: 600000; salt: string };
  iv: string;
  ciphertext: string;
}
export async function backupKey(password: string, salt: ArrayBuffer) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
function aad(header: Omit<EncryptedBackup, "ciphertext" | "iv">) {
  return new TextEncoder().encode(JSON.stringify(header));
}
export async function encryptBackup(payload: unknown, password: string): Promise<EncryptedBackup> {
  if (password.length < 12) throw new Error("Yedek şifresi en az 12 karakter olmalı.");
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const header = { format: "vaultmaster-personal-backup" as const, version: 3 as const,
    kdf: { name: "PBKDF2-SHA256" as const, iterations: ITERATIONS as 600000, salt: arrayBufferToBase64(salt.buffer) } };
  const key = await backupKey(password, salt.buffer);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(header), tagLength: 128 },
    key, new TextEncoder().encode(JSON.stringify(payload)));
  return { ...header, iv: arrayBufferToBase64(iv.buffer), ciphertext: arrayBufferToBase64(ciphertext) };
}
export async function decryptBackup<T>(input: unknown, password: string): Promise<T> {
  const file = input as Partial<EncryptedBackup> | null;
  if (!file || file.format !== "vaultmaster-personal-backup" || file.version !== 3 ||
      file.kdf?.name !== "PBKDF2-SHA256" || file.kdf.iterations !== ITERATIONS ||
      typeof file.kdf.salt !== "string" || typeof file.iv !== "string" || typeof file.ciphertext !== "string") {
    throw new Error("Desteklenmeyen yedek biçimi.");
  }
  const salt = base64ToArrayBuffer(file.kdf.salt);
  const iv = base64ToArrayBuffer(file.iv);
  const ciphertext = base64ToArrayBuffer(file.ciphertext);
  if (salt.byteLength !== 32 || iv.byteLength !== 12 || ciphertext.byteLength < 16) throw new Error("Geçersiz yedek dosyası.");
  const header = { format: file.format, version: file.version, kdf: { name: file.kdf.name, iterations: file.kdf.iterations, salt: file.kdf.salt } };
  const key = await backupKey(password, salt);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: aad(header), tagLength: 128 }, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}
