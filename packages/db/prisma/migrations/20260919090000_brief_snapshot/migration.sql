-- The morning's ledger: what the board held at each hour, so "since yesterday" compares against a recorded state rather than a memory.
CREATE TABLE "BriefSnapshot" (
    "id" TEXT NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "barnDate" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "open" INTEGER NOT NULL,
    "atStakeCents" INTEGER NOT NULL,
    "withStake" INTEGER NOT NULL,
    "bySource" JSONB NOT NULL,
    "bySeverity" JSONB NOT NULL,
    "openIds" JSONB NOT NULL,

    CONSTRAINT "BriefSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BriefSnapshot_takenAt_idx" ON "BriefSnapshot"("takenAt");
