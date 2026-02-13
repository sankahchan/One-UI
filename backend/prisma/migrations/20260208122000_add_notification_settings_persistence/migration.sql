CREATE TABLE IF NOT EXISTS "notification_settings" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "webhookEnabled" BOOLEAN NOT NULL DEFAULT false,
  "webhookUrl" TEXT NOT NULL DEFAULT '',
  "webhookSecret" TEXT NOT NULL DEFAULT '',
  "timeoutMs" INTEGER NOT NULL DEFAULT 10000,
  "retryAttempts" INTEGER NOT NULL DEFAULT 3,
  "retryDelayMs" INTEGER NOT NULL DEFAULT 1000,
  "routeDefaultWebhook" BOOLEAN NOT NULL DEFAULT true,
  "routeDefaultTelegram" BOOLEAN NOT NULL DEFAULT false,
  "routeDefaultSystemLog" BOOLEAN NOT NULL DEFAULT true,
  "routes" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "notification_settings" (
  "id",
  "webhookEnabled",
  "webhookUrl",
  "webhookSecret",
  "timeoutMs",
  "retryAttempts",
  "retryDelayMs",
  "routeDefaultWebhook",
  "routeDefaultTelegram",
  "routeDefaultSystemLog",
  "routes",
  "updatedAt"
)
VALUES (
  1,
  false,
  '',
  '',
  10000,
  3,
  1000,
  true,
  false,
  true,
  '{}'::jsonb,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;
