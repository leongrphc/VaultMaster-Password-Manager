import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../config/env.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const ENCRYPTED_PREFIX = "enc:v1";

function getEncryptionKey() {
  return Buffer.from(env.APP_ENCRYPTION_KEY, "base64");
}

export function encryptSensitiveValue(value: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv);

  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    ENCRYPTED_PREFIX,
    iv.toString("base64"),
    authTag.toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

export function decryptSensitiveValue(payload: string): string {
  const [prefixNamespace, prefixVersion, ivBase64, authTagBase64, encryptedBase64] =
    payload.split(":");
  const prefix = `${prefixNamespace}:${prefixVersion}`;

  if (
    prefix !== ENCRYPTED_PREFIX ||
    !ivBase64 ||
    !authTagBase64 ||
    !encryptedBase64
  ) {
    throw new Error("Geçersiz şifreli payload");
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    getEncryptionKey(),
    Buffer.from(ivBase64, "base64")
  );
  const authTag = Buffer.from(authTagBase64, "base64");

  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error("Geçersiz auth tag");
  }

  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedBase64, "base64")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

export function readStoredSecret(payload: string): string {
  if (!payload.startsWith(`${ENCRYPTED_PREFIX}:`)) {
    return payload;
  }

  return decryptSensitiveValue(payload);
}
