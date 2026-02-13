-- CreateEnum
CREATE TYPE "TrafficResetPeriod" AS ENUM ('NEVER', 'DAILY', 'WEEKLY', 'MONTHLY');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Protocol" ADD VALUE 'WIREGUARD';
ALTER TYPE "Protocol" ADD VALUE 'MTPROTO';

-- AlterEnum
ALTER TYPE "Security" ADD VALUE 'REALITY';

-- AlterTable
ALTER TABLE "inbounds" ADD COLUMN     "domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "fallbacks" JSONB DEFAULT '[]',
ADD COLUMN     "realityFingerprint" TEXT DEFAULT 'chrome',
ADD COLUMN     "realityPrivateKey" TEXT,
ADD COLUMN     "realityPublicKey" TEXT,
ADD COLUMN     "realityServerNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "realityShortIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "wgAddress" TEXT,
ADD COLUMN     "wgMtu" INTEGER DEFAULT 1420,
ADD COLUMN     "wgPrivateKey" TEXT,
ADD COLUMN     "wgPublicKey" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "deviceLimit" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ipLimit" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastTrafficReset" TIMESTAMP(3),
ADD COLUMN     "trafficResetDay" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "trafficResetPeriod" "TrafficResetPeriod" NOT NULL DEFAULT 'NEVER';

-- CreateTable
CREATE TABLE "subscription_templates" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'html',
    "content" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "adminId" INTEGER NOT NULL,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connection_logs" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "inboundId" INTEGER NOT NULL,
    "clientIp" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connection_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "xray_templates" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "xray_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscription_templates_name_key" ON "subscription_templates"("name");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_key" ON "api_keys"("key");

-- CreateIndex
CREATE INDEX "api_keys_key_idx" ON "api_keys"("key");

-- CreateIndex
CREATE INDEX "connection_logs_userId_timestamp_idx" ON "connection_logs"("userId", "timestamp");

-- CreateIndex
CREATE INDEX "connection_logs_clientIp_idx" ON "connection_logs"("clientIp");

-- CreateIndex
CREATE INDEX "connection_logs_timestamp_idx" ON "connection_logs"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "xray_templates_name_key" ON "xray_templates"("name");

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connection_logs" ADD CONSTRAINT "connection_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connection_logs" ADD CONSTRAINT "connection_logs_inboundId_fkey" FOREIGN KEY ("inboundId") REFERENCES "inbounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
