-- Raise with the default error code (P0001) so the application sees the trigger's own message
-- ("… is append-only") instead of a generic constraint error mapped by the ORM.

CREATE OR REPLACE FUNCTION daysheet_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% rejected)', TG_TABLE_NAME, TG_OP;
END;
$$;

CREATE OR REPLACE FUNCTION daysheet_integration_event_write_once() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."payload" IS DISTINCT FROM OLD."payload"
     OR NEW."provider" IS DISTINCT FROM OLD."provider"
     OR NEW."externalId" IS DISTINCT FROM OLD."externalId"
     OR NEW."type" IS DISTINCT FROM OLD."type"
     OR NEW."receivedAt" IS DISTINCT FROM OLD."receivedAt" THEN
    RAISE EXCEPTION 'IntegrationEvent identity and payload are write-once (%)', OLD."id";
  END IF;
  RETURN NEW;
END;
$$;
