ALTER TABLE "connection_logs"
ADD COLUMN IF NOT EXISTS "deviceFingerprint" VARCHAR(64),
ADD COLUMN IF NOT EXISTS "userAgent" TEXT;

CREATE INDEX IF NOT EXISTS "connection_logs_userId_deviceFingerprint_timestamp_idx"
ON "connection_logs"("userId", "deviceFingerprint", "timestamp");
