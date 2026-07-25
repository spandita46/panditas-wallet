-- CreateEnum
CREATE TYPE "FolderSyncFileType" AS ENUM ('csv', 'xlsx', 'pdf');

-- CreateEnum
CREATE TYPE "FolderSyncStatus" AS ENUM ('needs_review', 'needs_account', 'parse_failed', 'committed', 'rejected');

-- CreateEnum
CREATE TYPE "FolderSyncMappingSource" AS ENUM ('cache_hit', 'agent');

-- CreateTable
CREATE TABLE "FolderSyncMapping" (
    "id" TEXT NOT NULL,
    "headerFingerprint" TEXT NOT NULL,
    "sourceLabel" TEXT,
    "dateColumn" INTEGER NOT NULL,
    "dateFormat" TEXT NOT NULL,
    "payeeColumn" INTEGER,
    "memoColumn" INTEGER,
    "amountMode" TEXT NOT NULL,
    "amountColumn" INTEGER,
    "flipSign" BOOLEAN NOT NULL DEFAULT false,
    "debitColumn" INTEGER,
    "creditColumn" INTEGER,
    "suggestedAccountId" TEXT,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FolderSyncMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingImport" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "fileType" "FolderSyncFileType" NOT NULL,
    "status" "FolderSyncStatus" NOT NULL DEFAULT 'needs_review',
    "mappingSource" "FolderSyncMappingSource" NOT NULL,
    "mappingCacheId" TEXT,
    "accountId" TEXT,
    "confidence" DOUBLE PRECISION,
    "rows" JSONB NOT NULL,
    "notes" TEXT,
    "errorMessage" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PendingImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FolderSyncMapping_headerFingerprint_key" ON "FolderSyncMapping"("headerFingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "PendingImport_fileHash_key" ON "PendingImport"("fileHash");

-- CreateIndex
CREATE INDEX "PendingImport_status_idx" ON "PendingImport"("status");

-- AddForeignKey
ALTER TABLE "FolderSyncMapping" ADD CONSTRAINT "FolderSyncMapping_suggestedAccountId_fkey" FOREIGN KEY ("suggestedAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingImport" ADD CONSTRAINT "PendingImport_mappingCacheId_fkey" FOREIGN KEY ("mappingCacheId") REFERENCES "FolderSyncMapping"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingImport" ADD CONSTRAINT "PendingImport_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingImport" ADD CONSTRAINT "PendingImport_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
