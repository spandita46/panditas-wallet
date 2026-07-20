-- Add "transfer" as a category kind (e.g. credit card payments, inter-account
-- moves) so they can be excluded from spending insights without losing the
-- ability to categorize/track them.
ALTER TYPE "CategoryKind" ADD VALUE 'transfer';
