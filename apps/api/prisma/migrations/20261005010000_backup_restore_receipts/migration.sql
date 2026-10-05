CREATE TABLE "backup_restores" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "backupId" TEXT NOT NULL,
  "counts" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "backup_restores_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "backup_restores_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "backup_restores_userId_backupId_key" ON "backup_restores"("userId", "backupId");
