-- User-friendly account nickname (display falls back to the synced name).
ALTER TABLE "Account" ADD COLUMN "label" TEXT;
