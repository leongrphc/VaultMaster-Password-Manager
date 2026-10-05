-- Existing accounts retain their original data key until the client wraps it.
ALTER TABLE "users"
ADD COLUMN "wrappedVaultKey" TEXT,
ADD COLUMN "wrappedVaultKeyIv" TEXT,
ADD COLUMN "vaultKeyVersion" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "users" ADD CONSTRAINT "users_vault_key_envelope_check" CHECK (
  ("vaultKeyVersion" = 0 AND "wrappedVaultKey" IS NULL AND "wrappedVaultKeyIv" IS NULL)
  OR ("vaultKeyVersion" > 0 AND "wrappedVaultKey" IS NOT NULL AND "wrappedVaultKeyIv" IS NOT NULL)
);
