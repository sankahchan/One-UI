-- Add additional inbound protocols similar to 3x-ui
ALTER TYPE "Protocol" ADD VALUE IF NOT EXISTS 'SOCKS';
ALTER TYPE "Protocol" ADD VALUE IF NOT EXISTS 'HTTP';

-- Add missing Wireguard peer fields used by the application
ALTER TABLE "inbounds"
  ADD COLUMN IF NOT EXISTS "wgPeerPublicKey" TEXT,
  ADD COLUMN IF NOT EXISTS "wgPeerEndpoint" TEXT,
  ADD COLUMN IF NOT EXISTS "wgAllowedIPs" TEXT;
