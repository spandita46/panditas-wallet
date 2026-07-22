-- Drops the old single-condition CategoryRule columns now that every existing
-- rule has been backfilled into CategoryRuleCondition (verified 64/64 1:1
-- before this migration was written).

ALTER TABLE "CategoryRule" DROP CONSTRAINT IF EXISTS "CategoryRule_matchAccountId_fkey";
ALTER TABLE "CategoryRule" DROP COLUMN "matchType";
ALTER TABLE "CategoryRule" DROP COLUMN "matchAccountId";
ALTER TABLE "CategoryRule" DROP COLUMN "pattern";
DROP TYPE "RuleMatchType";
