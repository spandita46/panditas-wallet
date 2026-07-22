-- AlterTable
ALTER TABLE "Account" ADD COLUMN "mergedIntoId" TEXT;
ALTER TABLE "Account" ADD COLUMN "newAcknowledgedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Institution" ADD COLUMN "newAcknowledgedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "NetWorthCheckpoint" (
    "id" TEXT NOT NULL,
    "assetsTotal" DECIMAL(14,2) NOT NULL,
    "liabilitiesTotal" DECIMAL(14,2) NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NetWorthCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Account_mergedIntoId_idx" ON "Account"("mergedIntoId");

-- CreateIndex
CREATE INDEX "NetWorthCheckpoint_computedAt_idx" ON "NetWorthCheckpoint"("computedAt");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_mergedIntoId_fkey"
  FOREIGN KEY ("mergedIntoId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: existing rows are not "new" — without this every pre-existing
-- account/institution would show a "New" badge the moment this ships.
UPDATE "Account" SET "newAcknowledgedAt" = "createdAt" WHERE "newAcknowledgedAt" IS NULL;
UPDATE "Institution" SET "newAcknowledgedAt" = "createdAt" WHERE "newAcknowledgedAt" IS NULL;
