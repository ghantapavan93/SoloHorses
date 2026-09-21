-- A proposal is bound to the records it was made from: approval compares this fingerprint before the rule runs (ADR-017).
ALTER TABLE "Proposal" ADD COLUMN "stateHash" TEXT;
