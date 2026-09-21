-- CreateEnum
CREATE TYPE "SaleLotKind" AS ENUM ('HORSE', 'IN_UTERO');

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('REGISTRATION_CERTIFICATE');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('HELD', 'ELIGIBLE', 'RELEASED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ClearanceKind" ADD VALUE 'VIDEO_IN_FOAL';
ALTER TYPE "ClearanceKind" ADD VALUE 'RETURN_ASSESSMENT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ExceptionKind" ADD VALUE 'PAPERS_HELD';
ALTER TYPE "ExceptionKind" ADD VALUE 'SETTLEMENT_CONFLICT';
ALTER TYPE "ExceptionKind" ADD VALUE 'RETURN_ASSESSMENT_MISSING';
ALTER TYPE "ExceptionKind" ADD VALUE 'DEPARTURE_UNCONFIRMED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "InvoiceKind" ADD VALUE 'RECIP_DEPOSIT';
ALTER TYPE "InvoiceKind" ADD VALUE 'IMPLANT_FEE';
ALTER TYPE "InvoiceKind" ADD VALUE 'SALE_SETTLEMENT';

-- AlterTable
ALTER TABLE "Horse" ADD COLUMN     "returnedOn" TIMESTAMP(3),
ADD COLUMN     "scheduledDepartureOn" TIMESTAMP(3),
ADD COLUMN     "weanedOn" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SaleLot" (
    "id" TEXT NOT NULL,
    "kind" "SaleLotKind" NOT NULL,
    "title" TEXT NOT NULL,
    "closedOn" TIMESTAMP(3) NOT NULL,
    "hammerCents" INTEGER NOT NULL,
    "buyerId" TEXT NOT NULL,
    "horseId" TEXT,
    "recipId" TEXT,
    "invoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaleLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "kind" "DocumentKind" NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'HELD',
    "lotId" TEXT NOT NULL,
    "eligibleAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "releasedById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SaleLot_invoiceId_key" ON "SaleLot"("invoiceId");

-- CreateIndex
CREATE INDEX "Document_status_idx" ON "Document"("status");

-- AddForeignKey
ALTER TABLE "SaleLot" ADD CONSTRAINT "SaleLot_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleLot" ADD CONSTRAINT "SaleLot_horseId_fkey" FOREIGN KEY ("horseId") REFERENCES "Horse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleLot" ADD CONSTRAINT "SaleLot_recipId_fkey" FOREIGN KEY ("recipId") REFERENCES "Horse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleLot" ADD CONSTRAINT "SaleLot_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "SaleLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
