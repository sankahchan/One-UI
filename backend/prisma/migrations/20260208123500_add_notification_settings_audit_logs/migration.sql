CREATE TABLE IF NOT EXISTS "notification_settings_audit_logs" (
  "id" SERIAL NOT NULL,
  "adminId" INTEGER,
  "adminUsername" TEXT,
  "requestIp" TEXT,
  "userAgent" TEXT,
  "action" TEXT NOT NULL DEFAULT 'UPDATE',
  "changedKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "before" JSONB,
  "after" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_settings_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "notification_settings_audit_logs_createdAt_idx"
  ON "notification_settings_audit_logs"("createdAt");

CREATE INDEX IF NOT EXISTS "notification_settings_audit_logs_adminId_createdAt_idx"
  ON "notification_settings_audit_logs"("adminId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'notification_settings_audit_logs_adminId_fkey'
  ) THEN
    ALTER TABLE "notification_settings_audit_logs"
      ADD CONSTRAINT "notification_settings_audit_logs_adminId_fkey"
      FOREIGN KEY ("adminId") REFERENCES "admins"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
