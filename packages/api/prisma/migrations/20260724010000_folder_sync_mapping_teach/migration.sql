-- AlterTable
ALTER TABLE "PendingImport" ADD COLUMN "headerFingerprint" TEXT;
ALTER TABLE "PendingImport" ADD COLUMN "columnMapping" JSONB;
