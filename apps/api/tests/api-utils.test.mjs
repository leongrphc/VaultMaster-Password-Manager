import test from "node:test";
import assert from "node:assert/strict";
import { parseEnv } from "../dist/config/env.js";
import {
  encryptSensitiveValue,
  decryptSensitiveValue,
  readStoredSecret,
} from "../dist/utils/secret-crypto.js";

const validEnv = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/app",
  DATABASE_DIRECT_URL: "postgresql://user:pass@localhost:5432/app",
  JWT_SECRET: "a".repeat(32),
  JWT_REFRESH_SECRET: "b".repeat(32),
  JWT_EXPIRES_IN: "15m",
  JWT_REFRESH_EXPIRES_IN: "7d",
  API_PORT: "4000",
  NODE_ENV: "test",
  CORS_ORIGIN: "http://localhost:3000,https://app.example.com",
  APP_ENCRYPTION_KEY: "Iqgdnj6zTOno1qTzP6+46sh4Vhvs13bWVeLD5TbLWXA=",
};

test("parseEnv validates and normalizes API configuration", () => {
  const parsed = parseEnv(validEnv);

  assert.equal(parsed.API_PORT, 4000);
  assert.deepEqual(parsed.CORS_ORIGIN, [
    "http://localhost:3000",
    "https://app.example.com",
  ]);
  assert.equal(parsed.NODE_ENV, "test");
});

test("parseEnv enables pgbouncer-safe parameters for Supabase pooler URLs", () => {
  const parsed = parseEnv({
    ...validEnv,
    DATABASE_URL:
      "postgresql://postgres.project:pass@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres",
  });

  assert.match(parsed.DATABASE_URL, /pgbouncer=true/);
  assert.match(parsed.DATABASE_URL, /connection_limit=1/);
  assert.match(parsed.DATABASE_URL, /sslmode=require/);
});

test("parseEnv rejects invalid encryption keys", () => {
  assert.throws(
    () =>
      parseEnv({
        ...validEnv,
        APP_ENCRYPTION_KEY: "invalid-base64",
      }),
    /32 byte/
  );
});

test("encryptSensitiveValue round-trips secrets", () => {
  const plaintext = "JBSWY3DPEHPK3PXP";
  const encrypted = encryptSensitiveValue(plaintext);

  assert.notEqual(encrypted, plaintext);
  assert.match(encrypted, /^enc:v1:/);
  assert.equal(decryptSensitiveValue(encrypted), plaintext);
});

test("readStoredSecret supports legacy plaintext values", () => {
  const plaintext = "JBSWY3DPEHPK3PXP";
  assert.equal(readStoredSecret(plaintext), plaintext);
});
