import { exportMasterKey, importMasterKey } from "./key-derivation.js";
import { type EncryptedPayload } from "./encryption.js";
import { arrayBufferToBase64, base64ToArrayBuffer } from "./utils.js";

const PURPOSE = new TextEncoder().encode("VaultMaster:password-wrapped-vault-key:v1");

// The data key stays stable across password changes. Only its encrypted
// envelope changes; history, trash, attachments and shared-key wrappers survive.
export async function createVaultKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

export async function wrapVaultKey(vaultKey: CryptoKey, passwordKey: CryptoKey): Promise<EncryptedPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv,
    additionalData: PURPOSE, tagLength: 128 }, passwordKey, await exportMasterKey(vaultKey));
  return { ciphertext: arrayBufferToBase64(ciphertext), iv: arrayBufferToBase64(iv.buffer) };
}

export async function unwrapVaultKey(envelope: EncryptedPayload, passwordKey: CryptoKey): Promise<CryptoKey> {
  const iv = base64ToArrayBuffer(envelope.iv);
  const ciphertext = base64ToArrayBuffer(envelope.ciphertext);
  if (iv.byteLength !== 12 || ciphertext.byteLength !== 48) throw new Error("Invalid vault key envelope");
  const raw = await crypto.subtle.decrypt({ name: "AES-GCM", iv,
    additionalData: PURPOSE, tagLength: 128 }, passwordKey, ciphertext);
  if (raw.byteLength !== 32) throw new Error("Invalid vault key envelope");
  return importMasterKey(arrayBufferToBase64(raw));
}
