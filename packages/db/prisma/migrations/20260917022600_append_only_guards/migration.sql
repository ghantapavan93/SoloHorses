-- Append-only guarantees enforced by the database, not by convention.
--
-- 1. AuditEvent rows can never be updated or deleted.
-- 2. IntegrationEvent payloads are write-once: status/processing columns may change,
--    the received payload and identity may not.

CREATE OR REPLACE FUNCTION daysheet_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% attempted on %)', TG_TABLE_NAME, TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER audit_event_append_only
  BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION daysheet_reject_mutation();

CREATE OR REPLACE FUNCTION daysheet_integration_event_write_once() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."payload" IS DISTINCT FROM OLD."payload"
     OR NEW."provider" IS DISTINCT FROM OLD."provider"
     OR NEW."externalId" IS DISTINCT FROM OLD."externalId"
     OR NEW."type" IS DISTINCT FROM OLD."type"
     OR NEW."receivedAt" IS DISTINCT FROM OLD."receivedAt" THEN
    RAISE EXCEPTION 'IntegrationEvent identity and payload are write-once (%)', OLD."id"
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER integration_event_write_once
  BEFORE UPDATE ON "IntegrationEvent"
  FOR EACH ROW EXECUTE FUNCTION daysheet_integration_event_write_once();

CREATE TRIGGER integration_event_no_delete
  BEFORE DELETE ON "IntegrationEvent"
  FOR EACH ROW EXECUTE FUNCTION daysheet_reject_mutation();
