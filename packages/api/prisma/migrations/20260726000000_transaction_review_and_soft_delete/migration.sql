-- AlterEnum
ALTER TYPE "TxnSource" ADD VALUE 'import_single';
ALTER TYPE "TxnSource" ADD VALUE 'import_folder_sync';

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedByUserId" TEXT,
ADD COLUMN     "rawPayload" JSONB;

-- CreateTable
CREATE TABLE "TransactionAnomaly" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "transactionIds" TEXT[],
    "detail" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedByUserId" TEXT,
    "resolutionNote" TEXT,

    CONSTRAINT "TransactionAnomaly_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TransactionAnomaly_fingerprint_key" ON "TransactionAnomaly"("fingerprint");

-- CreateIndex
CREATE INDEX "TransactionAnomaly_status_idx" ON "TransactionAnomaly"("status");

-- CreateIndex
CREATE INDEX "Transaction_deletedAt_idx" ON "Transaction"("deletedAt");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_deletedByUserId_fkey" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionAnomaly" ADD CONSTRAINT "TransactionAnomaly_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
