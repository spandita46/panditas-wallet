-- Per-account escape valve: when true, sync still updates balance/snapshot
-- but skips ingesting transactions for this account (for a feed that keeps
-- duplicating another account's activity under this one).
ALTER TABLE "Account" ADD COLUMN "suppressTransactionSync" BOOLEAN NOT NULL DEFAULT false;
