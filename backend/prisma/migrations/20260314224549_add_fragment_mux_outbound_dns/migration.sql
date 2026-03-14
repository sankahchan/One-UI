-- CreateEnum
CREATE TYPE "OutboundProtocol" AS ENUM ('FREEDOM', 'BLACKHOLE', 'SOCKS', 'HTTP', 'TROJAN', 'VMESS', 'VLESS', 'SHADOWSOCKS');

-- AlterTable
ALTER TABLE "inbounds" ADD COLUMN     "fragmentEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "fragmentInterval" TEXT,
ADD COLUMN     "fragmentLength" TEXT,
ADD COLUMN     "muxConcurrency" INTEGER NOT NULL DEFAULT 8,
ADD COLUMN     "muxEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "outbounds" (
    "id" SERIAL NOT NULL,
    "tag" TEXT NOT NULL,
    "protocol" "OutboundProtocol" NOT NULL,
    "address" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "remark" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "streamSettings" JSONB,
    "mux" JSONB,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outbounds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "outbounds_tag_key" ON "outbounds"("tag");

-- CreateIndex
CREATE INDEX "outbounds_enabled_priority_idx" ON "outbounds"("enabled", "priority");
