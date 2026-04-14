import {
  stringToArrayBuffer,
  arrayBufferToBase64,
  base64ToArrayBuffer,
} from "./utils.js";

const PBKDF2_ITERATIONS = 600_000;
const KEY_LENGTH = 256;

/**
 * PBKDF2 ile master key türetir.
 * Input: kullanıcının master password + email (salt olarak)
 * Output: 256-bit AES-GCM anahtarı
 */
export async function deriveMasterKey(
  masterPassword: string,
  email: string,
  iterations: number = PBKDF2_ITERATIONS
): Promise<CryptoKey> {
  const passwordBuffer = stringToArrayBuffer(masterPassword);
  const saltBuffer = stringToArrayBuffer(email.toLowerCase().trim());

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    passwordBuffer,
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBuffer,
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: KEY_LENGTH },
    true,
    ["encrypt", "decrypt"]
  );
}

/**
 * Master key'den exportable raw bytes alır.
 * Sadece auth hash türetmek için kullanılır.
 */
export async function exportMasterKey(
  masterKey: CryptoKey
): Promise<ArrayBuffer> {
  return crypto.subtle.exportKey("raw", masterKey);
}

/**
 * Master key'in Base64 string olarak export'unu döner.
 */
export async function exportMasterKeyBase64(
  masterKey: CryptoKey
): Promise<string> {
  const raw = await exportMasterKey(masterKey);
  return arrayBufferToBase64(raw);
}

/**
 * Base64-encoded raw key'den CryptoKey oluşturur.
 * Hafızada tutulan master key'i yeniden yüklemek için.
 */
export async function importMasterKey(
  base64Key: string
): Promise<CryptoKey> {
  const raw = base64ToArrayBuffer(base64Key);
  return crypto.subtle.importKey(
    "raw",
    raw,
    { name: "AES-GCM", length: KEY_LENGTH },
    true,
    ["encrypt", "decrypt"]
  );
}
