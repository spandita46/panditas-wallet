-- Move the SimpleFIN access URL off Institution onto a dedicated connection table.
-- One access URL returns accounts across many institutions/orgs.

ALTER TABLE "Institution" DROP COLUMN "accessUrlEncrypted";
ALTER TABLE "Institution" ADD COLUMN "connectionId" TEXT;

CREATE TABLE "SimplefinConnection" (
    "id" TEXT NOT NULL,
    "label" TEXT,
    "accessUrlEncrypted" TEXT NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'running',
    "statusMessage" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SimplefinConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Institution_provider_externalId_key" ON "Institution"("provider", "externalId");

ALTER TABLE "Institution"
    ADD CONSTRAINT "Institution_connectionId_fkey"
    FOREIGN KEY ("connectionId") REFERENCES "SimplefinConnection"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
