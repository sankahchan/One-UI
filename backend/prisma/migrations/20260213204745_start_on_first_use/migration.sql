-- AlterTable
ALTER TABLE "users" ADD COLUMN     "firstUsedAt" TIMESTAMP(3),
ADD COLUMN     "startOnFirstUse" BOOLEAN NOT NULL DEFAULT false;
