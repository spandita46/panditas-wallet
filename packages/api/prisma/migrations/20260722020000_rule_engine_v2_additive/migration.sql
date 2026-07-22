-- Rule engine v2: compound conditions, amount-range matching, category-level
-- default beneficiary tagging. Additive only — old CategoryRule columns
-- (matchType/matchAccountId/pattern) are left in place until a backfill
-- script has copied their data into CategoryRuleCondition; a follow-up
-- migration drops them.

CREATE TYPE "RuleConditionType" AS ENUM ('account', 'payee_contains', 'description_regex', 'amount_range');
CREATE TYPE "RuleLogic" AS ENUM ('all', 'any');

ALTER TABLE "Category" ADD COLUMN "defaultBeneficiary" "Beneficiary";
ALTER TABLE "Category" ADD COLUMN "defaultBeneficiaryUserId" TEXT;
ALTER TABLE "Category" ADD CONSTRAINT "Category_defaultBeneficiaryUserId_fkey"
  FOREIGN KEY ("defaultBeneficiaryUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CategoryRule" ADD COLUMN "logic" "RuleLogic" NOT NULL DEFAULT 'all';
ALTER TABLE "CategoryRule" ADD COLUMN "beneficiary" "Beneficiary";
ALTER TABLE "CategoryRule" ADD COLUMN "beneficiaryUserId" TEXT;
ALTER TABLE "CategoryRule" ADD CONSTRAINT "CategoryRule_beneficiaryUserId_fkey"
  FOREIGN KEY ("beneficiaryUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "CategoryRuleCondition" (
  "id" TEXT NOT NULL,
  "ruleId" TEXT NOT NULL,
  "type" "RuleConditionType" NOT NULL,
  "matchAccountId" TEXT,
  "pattern" TEXT,
  "minAmount" DECIMAL(14,2),
  "maxAmount" DECIMAL(14,2),
  CONSTRAINT "CategoryRuleCondition_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CategoryRuleCondition_ruleId_idx" ON "CategoryRuleCondition"("ruleId");
CREATE INDEX "CategoryRuleCondition_matchAccountId_idx" ON "CategoryRuleCondition"("matchAccountId");
ALTER TABLE "CategoryRuleCondition" ADD CONSTRAINT "CategoryRuleCondition_ruleId_fkey"
  FOREIGN KEY ("ruleId") REFERENCES "CategoryRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CategoryRuleCondition" ADD CONSTRAINT "CategoryRuleCondition_matchAccountId_fkey"
  FOREIGN KEY ("matchAccountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
