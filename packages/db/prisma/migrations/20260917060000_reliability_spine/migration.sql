-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'ACTIVE', 'RETRYING', 'COMPLETED', 'DEAD');

-- CreateEnum
CREATE TYPE "ExceptionKind" AS ENUM ('JOB_DEAD_LETTERED', 'WEBHOOK_FAILED', 'ACCOUNTING_SYNC_FAILED', 'RECONCILIATION_MISMATCH', 'INTEGRATION_DEGRADED', 'RECIPIENT_MISSING', 'CHECK_OVERDUE', 'SHIP_BLOCKED', 'INTAKE_UNCONFIRMED', 'CONFLICTING_RECORD');

-- CreateEnum
CREATE TYPE "ExceptionSeverity" AS ENUM ('INFO', 'WARN', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ExceptionSource" AS ENUM ('STRIPE', 'QBO', 'QUEUE', 'REPRODUCTION', 'VETERINARY', 'BILLING', 'RECONCILIATION', 'ASK');

-- CreateEnum
CREATE TYPE "ExceptionStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'IGNORED');

-- AlterEnum
ALTER TYPE "AuditSource" ADD VALUE 'LAB';

-- AlterTable
ALTER TABLE "AskMessage" ADD COLUMN     "contextVersion" TEXT,
ADD COLUMN     "promptVersion" TEXT,
ADD COLUMN     "servedFromCache" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "toolVersions" JSONB;

-- AlterTable
ALTER TABLE "Embryo" ADD COLUMN     "plannedRecipientId" TEXT;

-- AlterTable
ALTER TABLE "IntegrationEvent" ADD COLUMN     "duplicateDeliveries" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "DomainEvent" (
    "id" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "correlationId" TEXT,
    "causationId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "publishAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,

    CONSTRAINT "DomainEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessedEvent" (
    "consumer" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedEvent_pkey" PRIMARY KEY ("consumer","eventId")
);

-- CreateTable
CREATE TABLE "JobRecord" (
    "id" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL,
    "lastError" TEXT,
    "correlationId" TEXT,
    "causationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enqueuedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationalException" (
    "id" TEXT NOT NULL,
    "kind" "ExceptionKind" NOT NULL,
    "severity" "ExceptionSeverity" NOT NULL,
    "source" "ExceptionSource" NOT NULL,
    "status" "ExceptionStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "detail" JSONB,
    "entityType" TEXT,
    "entityId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "openKey" TEXT,
    "correlationId" TEXT,
    "ownerId" TEXT,
    "resolvedById" TEXT,
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "OperationalException_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DomainEvent_publishedAt_occurredAt_idx" ON "DomainEvent"("publishedAt", "occurredAt");

-- CreateIndex
CREATE INDEX "DomainEvent_aggregateType_aggregateId_occurredAt_idx" ON "DomainEvent"("aggregateType", "aggregateId", "occurredAt");

-- CreateIndex
CREATE INDEX "DomainEvent_correlationId_idx" ON "DomainEvent"("correlationId");

-- CreateIndex
CREATE INDEX "JobRecord_status_nextRunAt_idx" ON "JobRecord"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "JobRecord_queue_status_idx" ON "JobRecord"("queue", "status");

-- CreateIndex
CREATE INDEX "JobRecord_correlationId_idx" ON "JobRecord"("correlationId");

-- CreateIndex
CREATE UNIQUE INDEX "OperationalException_openKey_key" ON "OperationalException"("openKey");

-- CreateIndex
CREATE INDEX "OperationalException_status_severity_createdAt_idx" ON "OperationalException"("status", "severity", "createdAt");

-- CreateIndex
CREATE INDEX "OperationalException_entityType_entityId_idx" ON "OperationalException"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "OperationalException_correlationId_idx" ON "OperationalException"("correlationId");

-- AddForeignKey
ALTER TABLE "Embryo" ADD CONSTRAINT "Embryo_plannedRecipientId_fkey" FOREIGN KEY ("plannedRecipientId") REFERENCES "Horse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalException" ADD CONSTRAINT "OperationalException_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalException" ADD CONSTRAINT "OperationalException_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
