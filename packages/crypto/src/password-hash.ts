import {
  arrayBufferToBase64,
  stringToArrayBuffer,
} from "./utils.js";
import { exportMasterKey } from "./key-derivation.js";

/**
 * Sunucuya gönderilecek auth hash'i üretir.
 * masterKey → PBKDF2(masterKey, "auth") → SHA-256 → base64
 * Sunucu bu hash'i Argon2 ile tekrar hash'leyerek saklar.
 */
export async function generateAuthHash(
  masterKey: CryptoKey,
  masterPassword: string
): Promise<string> {
  const masterKeyRaw = await exportMasterKey(masterKey);
  const passwordBuffer = stringToArrayBuffer(masterPassword);

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    masterKeyRaw,
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: passwordBuffer,
      iterations: 1,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );

  return arrayBufferToBase64(derivedBits);
}
