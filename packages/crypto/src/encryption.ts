import {
  arrayBufferToBase64,
  base64ToArrayBuffer,
  stringToArrayBuffer,
  arrayBufferToString,
  generateRandomBytes,
} from "./utils.js";

const IV_LENGTH = 12; // 96-bit IV for AES-GCM
const TAG_LENGTH = 128; // 128-bit auth tag

export interface EncryptedPayload {
  ciphertext: string; // base64
  iv: string; // base64
}

/**
 * AES-256-GCM ile plaintext'i şifreler.
 * IV her şifreleme için benzersiz üretilir.
 * GCM modu ciphertext'e authentication tag ekler.
 */
export async function encrypt(
  plaintext: string,
  key: CryptoKey
): Promise<EncryptedPayload> {
  const ivBytes = generateRandomBytes(IV_LENGTH);
  const ivArray = new Uint8Array(IV_LENGTH);
  ivArray.set(ivBytes);
  const data = stringToArrayBuffer(plaintext);

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: ivArray as Uint8Array<ArrayBuffer>, tagLength: TAG_LENGTH },
    key,
    data
  );

  return {
    ciphertext: arrayBufferToBase64(encrypted),
    iv: arrayBufferToBase64(ivArray.buffer as ArrayBuffer),
  };
}

/**
 * AES-256-GCM ile şifreli veriyi çözer.
 * Auth tag doğrulaması GCM tarafından otomatik yapılır.
 */
export async function decrypt(
  ciphertext: string,
  iv: string,
  key: CryptoKey
): Promise<string> {
  const encryptedData = base64ToArrayBuffer(ciphertext);
  const rawIv = base64ToArrayBuffer(iv);
  const ivBuffer = new Uint8Array(rawIv);

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ivBuffer as Uint8Array<ArrayBuffer>, tagLength: TAG_LENGTH },
    key,
    encryptedData
  );

  return arrayBufferToString(decrypted);
}

/**
 * JSON objesini şifreler - vault item'lar için.
 */
export async function encryptJSON(
  data: unknown,
  key: CryptoKey
): Promise<EncryptedPayload> {
  const json = JSON.stringify(data);
  return encrypt(json, key);
}

/**
 * Şifrelenmiş JSON'u çözer ve parse eder.
 */
export async function decryptJSON<T = unknown>(
  ciphertext: string,
  iv: string,
  key: CryptoKey
): Promise<T> {
  const json = await decrypt(ciphertext, iv, key);
  return JSON.parse(json) as T;
}
