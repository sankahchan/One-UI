-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'AGENT');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'DISABLED', 'LIMITED');

-- CreateEnum
CREATE TYPE "Protocol" AS ENUM ('VLESS', 'VMESS', 'TROJAN', 'SHADOWSOCKS');

-- CreateEnum
CREATE TYPE "Network" AS ENUM ('TCP', 'WS', 'GRPC', 'HTTP');

-- CreateEnum
CREATE TYPE "Security" AS ENUM ('NONE', 'TLS');

-- CreateEnum
CREATE TYPE "LogLevel" AS ENUM ('INFO', 'WARNING', 'ERROR', 'CRITICAL');

-- CreateTable
CREATE TABLE "admins" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'ADMIN',
    "email" TEXT,
    "telegramId" BIGINT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "uuid" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "subscriptionToken" VARCHAR(64) NOT NULL,
    "dataLimit" BIGINT NOT NULL DEFAULT 0,
    "uploadUsed" BIGINT NOT NULL DEFAULT 0,
    "downloadUsed" BIGINT NOT NULL DEFAULT 0,
    "expireDate" TIMESTAMP(3) NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "note" TEXT,
    "telegramUsername" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbounds" (
    "id" SERIAL NOT NULL,
    "port" INTEGER NOT NULL,
    "protocol" "Protocol" NOT NULL,
    "tag" TEXT NOT NULL,
    "remark" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "network" "Network" NOT NULL DEFAULT 'TCP',
    "security" "Security" NOT NULL DEFAULT 'NONE',
    "serverName" TEXT,
    "serverAddress" TEXT NOT NULL,
    "alpn" TEXT,
    "wsPath" TEXT,
    "wsHost" TEXT,
    "grpcServiceName" TEXT,
    "cipher" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inbounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_inbounds" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "inboundId" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_inbounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "traffic_logs" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "upload" BIGINT NOT NULL,
    "download" BIGINT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "traffic_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_logs" (
    "id" SERIAL NOT NULL,
    "level" "LogLevel" NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admins_username_key" ON "admins"("username");

-- CreateIndex
CREATE UNIQUE INDEX "admins_telegramId_key" ON "admins"("telegramId");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_uuid_key" ON "users"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "users_subscriptionToken_key" ON "users"("subscriptionToken");

-- CreateIndex
CREATE INDEX "users_status_expireDate_idx" ON "users"("status", "expireDate");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "inbounds_port_key" ON "inbounds"("port");

-- CreateIndex
CREATE UNIQUE INDEX "inbounds_tag_key" ON "inbounds"("tag");

-- CreateIndex
CREATE INDEX "inbounds_enabled_idx" ON "inbounds"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "user_inbounds_userId_inboundId_key" ON "user_inbounds"("userId", "inboundId");

-- CreateIndex
CREATE INDEX "traffic_logs_userId_timestamp_idx" ON "traffic_logs"("userId", "timestamp");

-- CreateIndex
CREATE INDEX "system_logs_level_timestamp_idx" ON "system_logs"("level", "timestamp");

-- AddForeignKey
ALTER TABLE "user_inbounds" ADD CONSTRAINT "user_inbounds_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_inbounds" ADD CONSTRAINT "user_inbounds_inboundId_fkey" FOREIGN KEY ("inboundId") REFERENCES "inbounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "traffic_logs" ADD CONSTRAINT "traffic_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
