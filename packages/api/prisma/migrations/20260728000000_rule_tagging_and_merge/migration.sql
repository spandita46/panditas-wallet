-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "taggedByRuleId" TEXT;

-- CreateIndex
CREATE INDEX "Transaction_taggedByRuleId_idx" ON "Transaction"("taggedByRuleId");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_taggedByRuleId_fkey" FOREIGN KEY ("taggedByRuleId") REFERENCES "CategoryRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
