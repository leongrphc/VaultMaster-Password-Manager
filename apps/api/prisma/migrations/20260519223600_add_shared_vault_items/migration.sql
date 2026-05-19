-- CreateTable
CREATE TABLE "shared_vault_items" (
    "id" TEXT NOT NULL,
    "sharedVaultId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "encryptedData" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "favorite" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shared_vault_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shared_vault_items_sharedVaultId_idx" ON "shared_vault_items"("sharedVaultId");

-- CreateIndex
CREATE INDEX "shared_vault_items_sharedVaultId_deletedAt_idx" ON "shared_vault_items"("sharedVaultId", "deletedAt");

-- AddForeignKey
ALTER TABLE "shared_vault_items" ADD CONSTRAINT "shared_vault_items_sharedVaultId_fkey" FOREIGN KEY ("sharedVaultId") REFERENCES "shared_vaults"("id") ON DELETE CASCADE ON UPDATE CASCADE;
