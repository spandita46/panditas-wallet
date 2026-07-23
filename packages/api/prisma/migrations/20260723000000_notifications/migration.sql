CREATE TYPE "NotificationType" AS ENUM ('stale_institution', 'orphaned_account', 'net_worth_swing', 'new_account', 'new_institution');

CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dismissedAt" TIMESTAMP(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Notification_type_subjectId_key" ON "Notification"("type", "subjectId");

CREATE INDEX "Notification_dismissedAt_idx" ON "Notification"("dismissedAt");
