-- Transaction.transferAccountId: the other account involved in a transfer
-- (e.g. which credit card a payment went to).
ALTER TABLE "Transaction" ADD COLUMN "transferAccountId" TEXT;
CREATE INDEX "Transaction_transferAccountId_idx" ON "Transaction"("transferAccountId");
ALTER TABLE "Transaction"
    ADD CONSTRAINT "Transaction_transferAccountId_fkey"
    FOREIGN KEY ("transferAccountId") REFERENCES "Account"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- CategoryRule.linkedAccountId: auto-fill transferAccountId when this rule matches.
ALTER TABLE "CategoryRule" ADD COLUMN "linkedAccountId" TEXT;
CREATE INDEX "CategoryRule_linkedAccountId_idx" ON "CategoryRule"("linkedAccountId");
ALTER TABLE "CategoryRule"
    ADD CONSTRAINT "CategoryRule_linkedAccountId_fkey"
    FOREIGN KEY ("linkedAccountId") REFERENCES "Account"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
