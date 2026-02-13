-- AlterTable
ALTER TABLE "groups" ADD COLUMN     "dataLimit" BIGINT,
ADD COLUMN     "expiryDays" INTEGER,
ADD COLUMN     "ipLimit" INTEGER,
ADD COLUMN     "status" "UserStatus",
ADD COLUMN     "trafficResetDay" INTEGER,
ADD COLUMN     "trafficResetPeriod" "TrafficResetPeriod";
