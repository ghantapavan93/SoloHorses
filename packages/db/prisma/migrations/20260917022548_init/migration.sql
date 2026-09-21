-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'STALLION_OFFICE', 'RECIPS', 'VET', 'BILLING', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "HorseSex" AS ENUM ('MARE', 'STALLION', 'GELDING');

-- CreateEnum
CREATE TYPE "HorseKind" AS ENUM ('DONOR', 'RECIPIENT', 'STALLION', 'SALE');

-- CreateEnum
CREATE TYPE "Site" AS ENUM ('SOUTH', 'NORTH', 'RECIP_FARM', 'OFFSITE');

-- CreateEnum
CREATE TYPE "RecipStatus" AS ENUM ('AVAILABLE', 'SET_UP', 'CARRYING', 'LEASED_OUT', 'OPEN', 'RETIRED');

-- CreateEnum
CREATE TYPE "ContractType" AS ENUM ('FRESH_COOLED', 'FROZEN', 'ICSI');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('RESERVED', 'DEPOSIT_PAID', 'SIGNED', 'PAID_IN_FULL', 'SHIPPABLE', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SemenOrderStatus" AS ENUM ('PLACED', 'HOLD_UNPAID', 'SCHEDULED', 'SHIPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LabBatchStatus" AS ENUM ('SHIPPED', 'IN_PROGRESS', 'RESULTED');

-- CreateEnum
CREATE TYPE "EmbryoSource" AS ENUM ('ICSI', 'FLUSH', 'SHIPPED_IN');

-- CreateEnum
CREATE TYPE "EmbryoStatus" AS ENUM ('EXPECTED', 'IN_TRANSIT', 'ARRIVED', 'FROZEN', 'TRANSFERRED', 'PREGNANT', 'OPEN', 'LOST', 'FOALED');

-- CreateEnum
CREATE TYPE "CheckResult" AS ENUM ('HEARTBEAT', 'PREGNANT', 'OPEN', 'LOST', 'UNCLEAR');

-- CreateEnum
CREATE TYPE "InvoiceKind" AS ENUM ('DEPOSIT', 'STUD_FEE', 'CHUTE_FEE', 'LEASE_FEE', 'BOARD', 'ICSI_STALLION_FEE', 'EMBRYO_PURCHASE', 'LATE_RETURN', 'OTHER');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'OPEN', 'PAID', 'VOID', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CARD', 'ACH', 'CHECK', 'CASH');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('STRIPE', 'QBO', 'TWILIO', 'RESEND', 'LAB');

-- CreateEnum
CREATE TYPE "IntegrationEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'DUPLICATE', 'FAILED', 'IGNORED');

-- CreateEnum
CREATE TYPE "MappedEntityType" AS ENUM ('CUSTOMER', 'INVOICE', 'PAYMENT', 'CREDIT');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('PENDING', 'SYNCED', 'FAILED', 'MISMATCH', 'ORPHANED');

-- CreateEnum
CREATE TYPE "DiscrepancyKind" AS ENUM ('AMOUNT_MISMATCH', 'CUSTOMER_MISMATCH', 'MISSING_REMOTE', 'MISSING_LOCAL', 'UNLINKED_PAYMENT', 'SYNC_FAILED');

-- CreateEnum
CREATE TYPE "DiscrepancyResolution" AS ENUM ('REPUSH_LOCAL', 'ACCEPT_REMOTE', 'RETRY', 'IGNORE');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('SMS', 'EMAIL');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('RECEIVED', 'PARSED', 'CONFIRMED', 'REJECTED', 'QUEUED', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('OPEN', 'ANSWERED', 'CLOSED');

-- CreateEnum
CREATE TYPE "AskRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "FeedbackRating" AS ENUM ('UP', 'DOWN');

-- CreateEnum
CREATE TYPE "MemoryScope" AS ENUM ('USER', 'ORG');

-- CreateEnum
CREATE TYPE "MemorySource" AS ENUM ('USER_STATED', 'CORRECTED', 'IMPORTED');

-- CreateEnum
CREATE TYPE "EvalCategory" AS ENUM ('GROUNDING', 'ABSTAIN', 'CONFLICT', 'PERMISSION', 'INJECTION', 'VETERINARY_BOUNDARY', 'FINANCIAL_BOUNDARY', 'STRUCTURE', 'TERMINOLOGY', 'MEMORY');

-- CreateEnum
CREATE TYPE "EvalCaseSource" AS ENUM ('AUTHORED', 'FROM_FEEDBACK');

-- CreateEnum
CREATE TYPE "AuditSource" AS ENUM ('UI', 'API', 'WEBHOOK', 'JOB', 'AI', 'SEED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "customerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "stripeCustomerId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Horse" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sex" "HorseSex" NOT NULL,
    "kind" "HorseKind" NOT NULL,
    "site" "Site" NOT NULL,
    "birthYear" INTEGER,
    "registrationNo" TEXT,
    "ownerId" TEXT,
    "recipNumber" INTEGER,
    "recipStatus" "RecipStatus",
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Horse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "type" "ContractType" NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'RESERVED',
    "customerId" TEXT NOT NULL,
    "stallionId" TEXT NOT NULL,
    "mareId" TEXT,
    "studFeeCents" INTEGER NOT NULL,
    "chuteFeeCents" INTEGER NOT NULL,
    "depositCents" INTEGER NOT NULL,
    "signedAt" TIMESTAMP(3),
    "esignEnvelopeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SemenOrder" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "mareId" TEXT NOT NULL,
    "status" "SemenOrderStatus" NOT NULL DEFAULT 'PLACED',
    "requestedFor" TIMESTAMP(3) NOT NULL,
    "placedAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "shipToVet" TEXT NOT NULL,
    "shipToCity" TEXT NOT NULL,
    "container" TEXT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "SemenOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Aspiration" (
    "id" TEXT NOT NULL,
    "donorMareId" TEXT NOT NULL,
    "contractId" TEXT,
    "performedOn" TIMESTAMP(3) NOT NULL,
    "oocyteCount" INTEGER NOT NULL,
    "labBatchId" TEXT,

    CONSTRAINT "Aspiration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabBatch" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "LabBatchStatus" NOT NULL DEFAULT 'SHIPPED',
    "shippedOn" TIMESTAMP(3) NOT NULL,
    "expectedResultOn" TIMESTAMP(3) NOT NULL,
    "resultReceivedOn" TIMESTAMP(3),
    "embryoCount" INTEGER,
    "notes" TEXT,

    CONSTRAINT "LabBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Embryo" (
    "id" TEXT NOT NULL,
    "source" "EmbryoSource" NOT NULL,
    "status" "EmbryoStatus" NOT NULL,
    "customerId" TEXT NOT NULL,
    "contractId" TEXT,
    "aspirationId" TEXT,
    "sireId" TEXT,
    "damId" TEXT,
    "sireName" TEXT,
    "damName" TEXT,
    "icsiOrOvulationOn" TIMESTAMP(3),
    "expectedOn" TIMESTAMP(3),
    "arrivedAt" TIMESTAMP(3),
    "storageTank" TEXT,
    "storageSlot" TEXT,
    "sendingVet" TEXT,
    "intakeMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Embryo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transfer" (
    "id" TEXT NOT NULL,
    "embryoId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "performedOn" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,

    CONSTRAINT "Transfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PregnancyCheck" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "dayNumber" INTEGER NOT NULL,
    "performedOn" TIMESTAMP(3) NOT NULL,
    "result" "CheckResult" NOT NULL,
    "recordedById" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PregnancyCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "kind" "InvoiceKind" NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'OPEN',
    "customerId" TEXT NOT NULL,
    "contractId" TEXT,
    "embryoId" TEXT,
    "transferId" TEXT,
    "triggeredByCheckId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "issuedOn" TIMESTAMP(3) NOT NULL,
    "dueOn" TIMESTAMP(3) NOT NULL,
    "stripeInvoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT,
    "customerId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "refundedCents" INTEGER NOT NULL DEFAULT 0,
    "stripePaymentIntentId" TEXT,
    "stripeChargeId" TEXT,
    "failureReason" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT,
    "stripeRefundId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationEvent" (
    "id" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "externalId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "IntegrationEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "error" TEXT,
    "correlationId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "IntegrationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingMapping" (
    "id" TEXT NOT NULL,
    "entityType" "MappedEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL DEFAULT 'QBO',
    "externalId" TEXT,
    "syncToken" TEXT,
    "status" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountingMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncAttempt" (
    "id" TEXT NOT NULL,
    "mappingId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "ok" BOOLEAN,
    "httpStatus" INTEGER,
    "error" TEXT,
    "remoteRequestId" TEXT,
    "jobId" TEXT,

    CONSTRAINT "SyncAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Discrepancy" (
    "id" TEXT NOT NULL,
    "kind" "DiscrepancyKind" NOT NULL,
    "mappingId" TEXT,
    "entityType" "MappedEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "localValue" JSONB,
    "remoteValue" JSONB,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolution" "DiscrepancyResolution",
    "resolvedById" TEXT,
    "note" TEXT,

    CONSTRAINT "Discrepancy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "status" "MessageStatus" NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "parsed" JSONB,
    "customerId" TEXT,
    "providerMessageId" TEXT,
    "inReplyToId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Request" (
    "id" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "evidenceIds" TEXT[],
    "status" "RequestStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AskConversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AskConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AskMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "AskRole" NOT NULL,
    "content" TEXT NOT NULL,
    "structured" JSONB,
    "evidenceIds" TEXT[],
    "toolCalls" JSONB,
    "model" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AskMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AskFeedback" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rating" "FeedbackRating" NOT NULL,
    "correction" TEXT,
    "promotedToEvalCaseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AskFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AskMemory" (
    "id" TEXT NOT NULL,
    "scope" "MemoryScope" NOT NULL,
    "userId" TEXT,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "source" "MemorySource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "AskMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvalCase" (
    "id" TEXT NOT NULL,
    "category" "EvalCategory" NOT NULL,
    "actorRole" "Role" NOT NULL,
    "actorCustomerId" TEXT,
    "input" TEXT NOT NULL,
    "expected" JSONB NOT NULL,
    "source" "EvalCaseSource" NOT NULL DEFAULT 'AUTHORED',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvalCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvalRun" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "model" TEXT NOT NULL,
    "gitSha" TEXT,
    "total" INTEGER NOT NULL DEFAULT 0,
    "passed" INTEGER NOT NULL DEFAULT 0,
    "costCents" INTEGER,

    CONSTRAINT "EvalRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvalResult" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "score" DOUBLE PRECISION,
    "actual" JSONB,
    "reason" TEXT,
    "latencyMs" INTEGER,

    CONSTRAINT "EvalResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "actorRole" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "source" "AuditSource" NOT NULL,
    "correlationId" TEXT,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_stripeCustomerId_key" ON "Customer"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Horse_recipNumber_key" ON "Horse"("recipNumber");

-- CreateIndex
CREATE INDEX "SemenOrder_requestedFor_status_idx" ON "SemenOrder"("requestedFor", "status");

-- CreateIndex
CREATE INDEX "Embryo_customerId_status_idx" ON "Embryo"("customerId", "status");

-- CreateIndex
CREATE INDEX "Transfer_performedOn_idx" ON "Transfer"("performedOn");

-- CreateIndex
CREATE INDEX "PregnancyCheck_transferId_dayNumber_idx" ON "PregnancyCheck"("transferId", "dayNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_stripeInvoiceId_key" ON "Invoice"("stripeInvoiceId");

-- CreateIndex
CREATE INDEX "Invoice_customerId_status_idx" ON "Invoice"("customerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_stripePaymentIntentId_key" ON "Payment"("stripePaymentIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_stripeChargeId_key" ON "Payment"("stripeChargeId");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_stripeRefundId_key" ON "Refund"("stripeRefundId");

-- CreateIndex
CREATE INDEX "IntegrationEvent_provider_status_receivedAt_idx" ON "IntegrationEvent"("provider", "status", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationEvent_provider_externalId_key" ON "IntegrationEvent"("provider", "externalId");

-- CreateIndex
CREATE INDEX "AccountingMapping_status_idx" ON "AccountingMapping"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingMapping_entityType_entityId_provider_key" ON "AccountingMapping"("entityType", "entityId", "provider");

-- CreateIndex
CREATE INDEX "Discrepancy_resolvedAt_idx" ON "Discrepancy"("resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Message_providerMessageId_key" ON "Message"("providerMessageId");

-- CreateIndex
CREATE INDEX "Message_direction_status_createdAt_idx" ON "Message"("direction", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AskFeedback_promotedToEvalCaseId_key" ON "AskFeedback"("promotedToEvalCaseId");

-- CreateIndex
CREATE UNIQUE INDEX "AskMemory_scope_userId_key_key" ON "AskMemory"("scope", "userId", "key");

-- CreateIndex
CREATE INDEX "EvalResult_runId_idx" ON "EvalResult"("runId");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_at_idx" ON "AuditEvent"("entityType", "entityId", "at");

-- CreateIndex
CREATE INDEX "AuditEvent_at_idx" ON "AuditEvent"("at");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Horse" ADD CONSTRAINT "Horse_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_stallionId_fkey" FOREIGN KEY ("stallionId") REFERENCES "Horse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_mareId_fkey" FOREIGN KEY ("mareId") REFERENCES "Horse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SemenOrder" ADD CONSTRAINT "SemenOrder_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SemenOrder" ADD CONSTRAINT "SemenOrder_mareId_fkey" FOREIGN KEY ("mareId") REFERENCES "Horse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Aspiration" ADD CONSTRAINT "Aspiration_donorMareId_fkey" FOREIGN KEY ("donorMareId") REFERENCES "Horse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Aspiration" ADD CONSTRAINT "Aspiration_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Aspiration" ADD CONSTRAINT "Aspiration_labBatchId_fkey" FOREIGN KEY ("labBatchId") REFERENCES "LabBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Embryo" ADD CONSTRAINT "Embryo_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Embryo" ADD CONSTRAINT "Embryo_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Embryo" ADD CONSTRAINT "Embryo_aspirationId_fkey" FOREIGN KEY ("aspirationId") REFERENCES "Aspiration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Embryo" ADD CONSTRAINT "Embryo_sireId_fkey" FOREIGN KEY ("sireId") REFERENCES "Horse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Embryo" ADD CONSTRAINT "Embryo_damId_fkey" FOREIGN KEY ("damId") REFERENCES "Horse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Embryo" ADD CONSTRAINT "Embryo_intakeMessageId_fkey" FOREIGN KEY ("intakeMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_embryoId_fkey" FOREIGN KEY ("embryoId") REFERENCES "Embryo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "Horse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PregnancyCheck" ADD CONSTRAINT "PregnancyCheck_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "Transfer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PregnancyCheck" ADD CONSTRAINT "PregnancyCheck_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_embryoId_fkey" FOREIGN KEY ("embryoId") REFERENCES "Embryo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "Transfer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_triggeredByCheckId_fkey" FOREIGN KEY ("triggeredByCheckId") REFERENCES "PregnancyCheck"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncAttempt" ADD CONSTRAINT "SyncAttempt_mappingId_fkey" FOREIGN KEY ("mappingId") REFERENCES "AccountingMapping"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Discrepancy" ADD CONSTRAINT "Discrepancy_mappingId_fkey" FOREIGN KEY ("mappingId") REFERENCES "AccountingMapping"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Discrepancy" ADD CONSTRAINT "Discrepancy_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Request" ADD CONSTRAINT "Request_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AskConversation" ADD CONSTRAINT "AskConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AskMessage" ADD CONSTRAINT "AskMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AskConversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AskFeedback" ADD CONSTRAINT "AskFeedback_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "AskMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AskFeedback" ADD CONSTRAINT "AskFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AskFeedback" ADD CONSTRAINT "AskFeedback_promotedToEvalCaseId_fkey" FOREIGN KEY ("promotedToEvalCaseId") REFERENCES "EvalCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AskMemory" ADD CONSTRAINT "AskMemory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvalResult" ADD CONSTRAINT "EvalResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "EvalRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvalResult" ADD CONSTRAINT "EvalResult_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "EvalCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
