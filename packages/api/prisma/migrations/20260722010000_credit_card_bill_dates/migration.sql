-- Manual, approximate credit-card bill-cycle config.
ALTER TABLE "Account" ADD COLUMN "statementDay" INTEGER;
ALTER TABLE "Account" ADD COLUMN "dueDay" INTEGER;
