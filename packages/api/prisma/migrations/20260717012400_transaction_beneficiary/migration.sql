-- Transaction "beneficiary": who the spend was for (self / family member / household / external).
CREATE TYPE "Beneficiary" AS ENUM ('self', 'family_member', 'household', 'external');

ALTER TABLE "Transaction" ADD COLUMN "beneficiary" "Beneficiary";
ALTER TABLE "Transaction" ADD COLUMN "beneficiaryUserId" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "beneficiaryNote" TEXT;

CREATE INDEX "Transaction_beneficiaryUserId_idx" ON "Transaction"("beneficiaryUserId");

ALTER TABLE "Transaction"
    ADD CONSTRAINT "Transaction_beneficiaryUserId_fkey"
    FOREIGN KEY ("beneficiaryUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
