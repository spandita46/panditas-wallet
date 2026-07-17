-- Add an "ignore/don't track" flag to accounts (excludes from net worth & lists).
ALTER TABLE "Account" ADD COLUMN "isTracked" BOOLEAN NOT NULL DEFAULT true;
