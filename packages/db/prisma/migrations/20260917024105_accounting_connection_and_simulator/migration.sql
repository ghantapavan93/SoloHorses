-- AlterEnum
ALTER TYPE "MappedEntityType" ADD VALUE 'ITEM';

-- CreateTable
CREATE TABLE "AccountingConnection" (
    "id" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL DEFAULT 'QBO',
    "realmId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "accessExpiresAt" TIMESTAMP(3) NOT NULL,
    "refreshExpiresAt" TIMESTAMP(3) NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountingConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimulatorRecord" (
    "id" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "entityType" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "docNumber" TEXT,
    "data" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SimulatorRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountingConnection_realmId_key" ON "AccountingConnection"("realmId");

-- CreateIndex
CREATE INDEX "SimulatorRecord_provider_entityType_docNumber_idx" ON "SimulatorRecord"("provider", "entityType", "docNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SimulatorRecord_provider_entityType_externalId_key" ON "SimulatorRecord"("provider", "entityType", "externalId");
