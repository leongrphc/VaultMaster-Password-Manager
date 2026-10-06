CREATE TABLE "backup_transfers" (
  "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "direction" TEXT NOT NULL CHECK ("direction" IN ('export', 'restore')),
  "totalBytes" INTEGER NOT NULL CHECK ("totalBytes" BETWEEN 1 AND 68157440),
  "chunkCount" INTEGER NOT NULL CHECK ("chunkCount" BETWEEN 1 AND 65), "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "backup_transfers_userId_expiresAt_idx" ON "backup_transfers"("userId", "expiresAt");
CREATE TABLE "backup_transfer_chunks" (
  "transferId" TEXT NOT NULL REFERENCES "backup_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "index" INTEGER NOT NULL CHECK ("index" BETWEEN 0 AND 64), "data" TEXT NOT NULL,
  PRIMARY KEY ("transferId", "index"), CHECK (OCTET_LENGTH("data") <= 1398104)
);
