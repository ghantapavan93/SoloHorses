-- AlterEnum
ALTER TYPE "IntegrationProvider" ADD VALUE 'AUCTION';

-- AlterTable
ALTER TABLE "SaleLot" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "lotNumber" INTEGER,
ADD COLUMN     "saleCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SaleLot_externalId_key" ON "SaleLot"("externalId");
