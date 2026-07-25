-- AlterTable
ALTER TABLE "PendingImport" ADD COLUMN "groupKey" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PendingImport" ADD COLUMN "rawAccountId" TEXT;

-- DropIndex (single-column unique replaced by a composite one)
DROP INDEX "PendingImport_fileHash_key";

-- CreateIndex
CREATE UNIQUE INDEX "PendingImport_fileHash_groupKey_key" ON "PendingImport"("fileHash", "groupKey");

-- AlterTable
ALTER TABLE "FolderSyncMapping" ADD COLUMN "accountColumn" INTEGER;
ALTER TABLE "FolderSyncMapping" ADD COLUMN "accountTypeColumn" INTEGER;
ALTER TABLE "FolderSyncMapping" ADD COLUMN "accountIdHints" JSONB;
