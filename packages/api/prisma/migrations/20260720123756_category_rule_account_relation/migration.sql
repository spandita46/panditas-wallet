-- Add FK relation from CategoryRule.matchAccountId to Account, for display + cascade cleanup.
ALTER TABLE "CategoryRule"
    ADD CONSTRAINT "CategoryRule_matchAccountId_fkey"
    FOREIGN KEY ("matchAccountId") REFERENCES "Account"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "CategoryRule_matchAccountId_idx" ON "CategoryRule"("matchAccountId");
