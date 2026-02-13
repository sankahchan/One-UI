-- CreateEnum
CREATE TYPE "SecurityRuleAction" AS ENUM ('ALLOW', 'BLOCK');

-- CreateEnum
CREATE TYPE "SecurityRuleTargetType" AS ENUM ('IP', 'CIDR', 'COUNTRY');

-- CreateEnum
CREATE TYPE "SubscriptionBrandingScope" AS ENUM ('GLOBAL', 'GROUP', 'USER');

-- CreateTable
CREATE TABLE "worker_locks" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "worker_locks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_rules" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "action" "SecurityRuleAction" NOT NULL,
    "targetType" "SecurityRuleTargetType" NOT NULL,
    "targetValue" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "hitCount" BIGINT NOT NULL DEFAULT 0,
    "lastMatchedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "security_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_branding" (
    "id" SERIAL NOT NULL,
    "scope" "SubscriptionBrandingScope" NOT NULL DEFAULT 'GLOBAL',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "name" TEXT NOT NULL,
    "appName" TEXT DEFAULT 'One-UI',
    "logoUrl" TEXT,
    "supportUrl" TEXT,
    "primaryColor" TEXT,
    "accentColor" TEXT,
    "profileTitle" TEXT,
    "profileDescription" TEXT,
    "customFooter" TEXT,
    "clashProfileName" TEXT,
    "metadata" JSONB,
    "userId" INTEGER,
    "groupId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_branding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_snapshots" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "email" TEXT,
    "uploadDelta" BIGINT NOT NULL DEFAULT 0,
    "downloadDelta" BIGINT NOT NULL DEFAULT 0,
    "totalDelta" BIGINT NOT NULL DEFAULT 0,
    "totalUsed" BIGINT NOT NULL DEFAULT 0,
    "dataLimit" BIGINT NOT NULL DEFAULT 0,
    "usagePercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "remainingBytes" BIGINT NOT NULL DEFAULT 0,
    "estimatedDepletionAt" TIMESTAMP(3),
    "isAnomaly" BOOLEAN NOT NULL DEFAULT false,
    "anomalyScore" DOUBLE PRECISION,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "worker_locks_name_key" ON "worker_locks"("name");

-- CreateIndex
CREATE INDEX "worker_locks_expiresAt_idx" ON "worker_locks"("expiresAt");

-- CreateIndex
CREATE INDEX "security_rules_enabled_priority_idx" ON "security_rules"("enabled", "priority");

-- CreateIndex
CREATE INDEX "security_rules_targetType_targetValue_idx" ON "security_rules"("targetType", "targetValue");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_branding_userId_key" ON "subscription_branding"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_branding_groupId_key" ON "subscription_branding"("groupId");

-- CreateIndex
CREATE INDEX "subscription_branding_scope_enabled_priority_idx" ON "subscription_branding"("scope", "enabled", "priority");

-- CreateIndex
CREATE INDEX "usage_snapshots_windowStart_windowEnd_idx" ON "usage_snapshots"("windowStart", "windowEnd");

-- CreateIndex
CREATE INDEX "usage_snapshots_userId_createdAt_idx" ON "usage_snapshots"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "usage_snapshots_isAnomaly_createdAt_idx" ON "usage_snapshots"("isAnomaly", "createdAt");

-- AddForeignKey
ALTER TABLE "subscription_branding" ADD CONSTRAINT "subscription_branding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_branding" ADD CONSTRAINT "subscription_branding_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_snapshots" ADD CONSTRAINT "usage_snapshots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
