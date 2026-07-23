CREATE TYPE "BillStatus" AS ENUM ('full', 'partial');

ALTER TABLE "Transaction" ADD COLUMN "billStatus" "BillStatus";
