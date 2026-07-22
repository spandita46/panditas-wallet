-- AlterTable
ALTER TABLE "Institution" ADD COLUMN "connId" TEXT;

-- CreateIndex
CREATE INDEX "Institution_connId_idx" ON "Institution"("connId");
