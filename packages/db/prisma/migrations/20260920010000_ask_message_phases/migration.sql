-- Where an answer's time went, stage by stage; the flight recorder reads it.
ALTER TABLE "AskMessage" ADD COLUMN "phases" JSONB;
