CREATE TABLE abuse_buckets (key TEXT PRIMARY KEY, count INTEGER NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL);
CREATE INDEX abuse_buckets_expiry ON abuse_buckets("expiresAt");
CREATE TABLE reauthentications (
  "tokenHash" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "deviceId" TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE ON UPDATE CASCADE,
  target TEXT NOT NULL, "stateHash" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX reauthentications_expiry ON reauthentications("expiresAt");
CREATE TABLE security_notifications (
  id TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  action TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "readAt" TIMESTAMP(3)
);
CREATE INDEX security_notifications_user_created ON security_notifications("userId", "createdAt");
