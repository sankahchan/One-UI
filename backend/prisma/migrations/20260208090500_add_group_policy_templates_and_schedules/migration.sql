-- CreateEnum
CREATE TYPE "GroupPolicySource" AS ENUM ('MANUAL', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "GroupPolicyRunStatus" AS ENUM ('SUCCESS', 'FAILED', 'DRY_RUN');

-- CreateTable
CREATE TABLE "group_policy_templates" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "dataLimit" BIGINT,
    "expiryDays" INTEGER,
    "ipLimit" INTEGER,
    "status" "UserStatus",
    "trafficResetPeriod" "TrafficResetPeriod",
    "trafficResetDay" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "group_policy_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_policy_schedules" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "groupId" INTEGER NOT NULL,
    "templateId" INTEGER,
    "cronExpression" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "targetUserIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "lastRunAt" TIMESTAMP(3),
    "lastStatus" "GroupPolicyRunStatus",
    "lastError" TEXT,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "group_policy_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_policy_rollouts" (
    "id" SERIAL NOT NULL,
    "groupId" INTEGER NOT NULL,
    "templateId" INTEGER,
    "scheduleId" INTEGER,
    "source" "GroupPolicySource" NOT NULL DEFAULT 'MANUAL',
    "status" "GroupPolicyRunStatus" NOT NULL,
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "initiatedBy" TEXT,
    "summary" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_policy_rollouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "group_policy_templates_name_key" ON "group_policy_templates"("name");

-- CreateIndex
CREATE INDEX "group_policy_templates_isDefault_idx" ON "group_policy_templates"("isDefault");

-- CreateIndex
CREATE INDEX "group_policy_schedules_enabled_groupId_idx" ON "group_policy_schedules"("enabled", "groupId");

-- CreateIndex
CREATE INDEX "group_policy_schedules_templateId_idx" ON "group_policy_schedules"("templateId");

-- CreateIndex
CREATE INDEX "group_policy_rollouts_groupId_createdAt_idx" ON "group_policy_rollouts"("groupId", "createdAt");

-- CreateIndex
CREATE INDEX "group_policy_rollouts_scheduleId_createdAt_idx" ON "group_policy_rollouts"("scheduleId", "createdAt");

-- CreateIndex
CREATE INDEX "group_policy_rollouts_status_createdAt_idx" ON "group_policy_rollouts"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "group_policy_schedules" ADD CONSTRAINT "group_policy_schedules_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_policy_schedules" ADD CONSTRAINT "group_policy_schedules_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "group_policy_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_policy_rollouts" ADD CONSTRAINT "group_policy_rollouts_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_policy_rollouts" ADD CONSTRAINT "group_policy_rollouts_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "group_policy_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_policy_rollouts" ADD CONSTRAINT "group_policy_rollouts_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "group_policy_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
