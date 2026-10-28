-- Dormant G1 approval custody. Only the protected authority writer may insert.
-- A fact is immutable, and its epoch must be advanced in the same transaction.
-- Historical pointers remain nullable until their next real epoch transition.
ALTER TABLE "SdkGrowthCurrentAuthority" ADD COLUMN "lastWriteXid" BIGINT;
CREATE FUNCTION sdk_growth_approval_stamp_current_xid() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  NEW."lastWriteXid" := pg_current_xact_id()::text::bigint;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sdk_growth_approval_stamp_current_xid
  BEFORE INSERT OR UPDATE ON "SdkGrowthCurrentAuthority"
  FOR EACH ROW EXECUTE FUNCTION sdk_growth_approval_stamp_current_xid();
REVOKE ALL ON FUNCTION sdk_growth_approval_stamp_current_xid() FROM PUBLIC;

CREATE TABLE "SdkGrowthApprovalFact" (
  "scopeKey" TEXT NOT NULL,
  "epoch" BIGINT NOT NULL CHECK ("epoch" > 0),
  "action" TEXT NOT NULL CHECK ("action" IN ('approve', 'revoke')),
  "approvalEpoch" BIGINT,
  "proposalReference" VARCHAR(256),
  "credentialId" VARCHAR(64) NOT NULL,
  "credentialGeneration" BIGINT NOT NULL CHECK ("credentialGeneration" > 0),
  "bindingDigest" VARCHAR(71) NOT NULL CHECK ("bindingDigest" ~ '^sha256:[a-f0-9]{64}$'),
  "decisionDigest" VARCHAR(71) NOT NULL CHECK ("decisionDigest" ~ '^sha256:[a-f0-9]{64}$'),
  "record" JSONB CHECK ("record" IS NULL OR octet_length("record"::text) <= 800000),
  "recordedAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY ("scopeKey", "epoch"),
  FOREIGN KEY ("scopeKey", "epoch") REFERENCES "SdkGrowthOwnerVersion"("scopeKey", "epoch") ON DELETE RESTRICT,
  FOREIGN KEY ("scopeKey", "approvalEpoch") REFERENCES "SdkGrowthApprovalFact"("scopeKey", "epoch") ON DELETE RESTRICT,
  FOREIGN KEY ("credentialId") REFERENCES "SdkGrowthOperatorCredential"("credentialId") ON DELETE RESTRICT,
  CONSTRAINT "SdkGrowthApprovalFact_shape" CHECK (
    ("action" = 'approve' AND "record" IS NOT NULL AND "proposalReference" IS NOT NULL AND "approvalEpoch" IS NULL)
    OR ("action" = 'revoke' AND "record" IS NULL AND "proposalReference" IS NULL AND "approvalEpoch" IS NOT NULL)
  )
);
CREATE INDEX "SdkGrowthApprovalFact_latest_idx"
  ON "SdkGrowthApprovalFact" ("scopeKey", "epoch" DESC);

CREATE TRIGGER sdk_growth_approval_immutable
  BEFORE UPDATE OR DELETE ON "SdkGrowthApprovalFact"
  FOR EACH ROW EXECUTE FUNCTION sdk_growth_snapshot_immutable();
CREATE TRIGGER sdk_growth_approval_no_truncate
  BEFORE TRUNCATE ON "SdkGrowthApprovalFact"
  FOR EACH STATEMENT EXECUTE FUNCTION sdk_growth_snapshot_immutable();

-- The pointer update and fact insert must belong to the same PostgreSQL
-- transaction. pg_current_xact_id() is full xid8, unlike recyclable xmin.
CREATE FUNCTION sdk_growth_approval_fact_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE current_epoch BIGINT;
DECLARE pointer_writer BIGINT;
DECLARE approval_action TEXT;
DECLARE authority_binding JSONB;
DECLARE authority_evidence JSONB;
DECLARE authority_provenance JSONB;
DECLARE authority_reason TEXT;
DECLARE authority_installation_active BOOLEAN;
DECLARE authority_verifier_active BOOLEAN;
DECLARE original_record JSONB;
BEGIN
  EXECUTE format('SELECT "epoch", "lastWriteXid" FROM %I.%I WHERE "scopeKey" = $1',
    TG_TABLE_SCHEMA, 'SdkGrowthCurrentAuthority')
    INTO current_epoch, pointer_writer USING NEW."scopeKey";
  IF current_epoch IS DISTINCT FROM NEW."epoch" OR
     pointer_writer IS NULL OR
     pointer_writer IS DISTINCT FROM pg_current_xact_id()::text::bigint THEN
    RAISE EXCEPTION 'approval fact requires authority epoch advance';
  END IF;
  EXECUTE format(
    'SELECT b."binding", o."evidence", o."provenance", o."reason", o."installationActive", o."verifierActive" FROM %I.%I b JOIN %I.%I o ON o."scopeKey" = b."scopeKey" AND o."epoch" = b."epoch" WHERE b."scopeKey" = $1 AND b."epoch" = $2',
    TG_TABLE_SCHEMA, 'SdkGrowthBindingVersion',
    TG_TABLE_SCHEMA, 'SdkGrowthOwnerVersion')
    INTO authority_binding, authority_evidence, authority_provenance, authority_reason,
      authority_installation_active, authority_verifier_active
    USING NEW."scopeKey", NEW."epoch";
  IF NEW."action" = 'approve' THEN
    IF authority_reason NOT IN ('provision', 'owner-replacement') OR
       NEW."record"->'binding' IS DISTINCT FROM authority_binding OR
       NEW."record"->'approvalProvenance' IS DISTINCT FROM authority_provenance OR
       (NEW."record"->>'installationActive')::boolean IS DISTINCT FROM authority_installation_active OR
       (NEW."record"->>'verifierActive')::boolean IS DISTINCT FROM authority_verifier_active OR
       (NEW."record"->'approval' || jsonb_build_object('binding', authority_binding))
         IS DISTINCT FROM authority_evidence THEN
      RAISE EXCEPTION 'approval fact does not match authority version';
    END IF;
  END IF;
  IF NEW."action" = 'revoke' THEN
    EXECUTE format('SELECT "action", "record" FROM %I.%I WHERE "scopeKey" = $1 AND "epoch" = $2',
      TG_TABLE_SCHEMA, 'SdkGrowthApprovalFact')
      INTO approval_action, original_record USING NEW."scopeKey", NEW."approvalEpoch";
    IF approval_action IS DISTINCT FROM 'approve' OR
       authority_reason IS DISTINCT FROM 'owner-revocation' OR
       NEW."approvalEpoch" <> NEW."epoch" - 1 OR
       original_record->'binding' IS DISTINCT FROM authority_binding OR
       original_record->'approvalProvenance' IS DISTINCT FROM authority_provenance OR
       (original_record->>'installationActive')::boolean IS DISTINCT FROM authority_installation_active OR
       (original_record->>'verifierActive')::boolean IS DISTINCT FROM authority_verifier_active OR
       (original_record->'approval' || jsonb_build_object('binding', authority_binding, 'revoked', true))
         IS DISTINCT FROM authority_evidence THEN
      RAISE EXCEPTION 'revocation must reference matching active approval';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER sdk_growth_approval_fact_advance
  AFTER INSERT ON "SdkGrowthApprovalFact"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION sdk_growth_approval_fact_guard();
REVOKE ALL ON FUNCTION sdk_growth_approval_fact_guard() FROM PUBLIC;
