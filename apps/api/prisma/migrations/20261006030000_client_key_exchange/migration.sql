CREATE TABLE "exchange_keys" (
  "id" TEXT PRIMARY KEY, "deviceId" TEXT NOT NULL UNIQUE,
  "card" JSONB NOT NULL, "wrapped" TEXT NOT NULL, "iv" TEXT NOT NULL,
  FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "exchange_grants" (
  "id" TEXT PRIMARY KEY, "senderKeyId" TEXT NOT NULL, "recipientKeyId" TEXT NOT NULL,
  "kind" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'pending', "revision" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL, "requestedAt" TIMESTAMP(3), "waitHours" INTEGER NOT NULL DEFAULT 24,
  "envelope" JSONB, "creationHash" TEXT NOT NULL,
  FOREIGN KEY ("senderKeyId") REFERENCES "exchange_keys"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("recipientKeyId") REFERENCES "exchange_keys"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "exchange_grants_recipientKeyId_expiresAt_idx" ON "exchange_grants"("recipientKeyId", "expiresAt");
