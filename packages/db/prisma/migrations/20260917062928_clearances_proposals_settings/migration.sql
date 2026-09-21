-- CreateEnum
CREATE TYPE "ClearanceKind" AS ENUM ('COGGINS', 'UTERINE_CULTURE', 'UTERINE_CYTOLOGY', 'PRE_TRANSFER_EXAM');

-- CreateEnum
CREATE TYPE "ClearanceResult" AS ENUM ('CLEAR', 'ABNORMAL', 'PENDING');

-- CreateEnum
CREATE TYPE "ProposalKind" AS ENUM ('ASSIGN_PLANNED_RECIPIENT');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('PROPOSED', 'APPROVED', 'DECLINED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ExceptionKind" ADD VALUE 'RECIPIENT_CONFLICT';
ALTER TYPE "ExceptionKind" ADD VALUE 'CLEARANCE_MISSING';

-- CreateTable
CREATE TABLE "Clearance" (
    "id" TEXT NOT NULL,
    "horseId" TEXT NOT NULL,
    "kind" "ClearanceKind" NOT NULL,
    "result" "ClearanceResult" NOT NULL,
    "performedOn" TIMESTAMP(3) NOT NULL,
    "expiresOn" TIMESTAMP(3),
    "recordedById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Clearance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Proposal" (
    "id" TEXT NOT NULL,
    "kind" "ProposalKind" NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'PROPOSED',
    "payload" JSONB NOT NULL,
    "rationale" TEXT NOT NULL,
    "evidenceIds" TEXT[],
    "proposedByUserId" TEXT NOT NULL,
    "askMessageId" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decision" TEXT,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "Clearance_horseId_kind_performedOn_idx" ON "Clearance"("horseId", "kind", "performedOn");

-- CreateIndex
CREATE INDEX "Proposal_status_createdAt_idx" ON "Proposal"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "Clearance" ADD CONSTRAINT "Clearance_horseId_fkey" FOREIGN KEY ("horseId") REFERENCES "Horse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
