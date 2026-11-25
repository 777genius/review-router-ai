-- Inactive fixture-only v3 approval. The manifest, authority version, fact and
-- current epoch must be committed together. No production writer is composed.
ALTER TABLE "SdkGrowthBindingVersion" ADD COLUMN "lastWriteXid" BIGINT;
ALTER TABLE "SdkGrowthOwnerVersion" ADD COLUMN "lastWriteXid" BIGINT;
CREATE FUNCTION sdk_growth_v3_stamp_version_xid() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  NEW."lastWriteXid" := pg_current_xact_id()::text::bigint;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sdk_growth_v3_stamp_binding_xid
  BEFORE INSERT ON "SdkGrowthBindingVersion"
  FOR EACH ROW EXECUTE FUNCTION sdk_growth_v3_stamp_version_xid();
CREATE TRIGGER sdk_growth_v3_stamp_owner_xid
  BEFORE INSERT ON "SdkGrowthOwnerVersion"
  FOR EACH ROW EXECUTE FUNCTION sdk_growth_v3_stamp_version_xid();
REVOKE ALL ON FUNCTION sdk_growth_v3_stamp_version_xid() FROM PUBLIC;

CREATE TABLE "SdkGrowthV3ApprovedManifest" (
  "manifestId" VARCHAR(64) PRIMARY KEY CHECK ("manifestId" ~ '^[a-f0-9]{64}$'),
  "scopeKey" TEXT NOT NULL,
  "epoch" BIGINT NOT NULL CHECK ("epoch" > 0),
  "manifestVersion" INTEGER NOT NULL DEFAULT 1 CHECK ("manifestVersion" = 1),
  "manifestWire" BYTEA NOT NULL,
  "manifestByteLength" INTEGER NOT NULL,
  "manifestSha256" VARCHAR(71) NOT NULL CHECK ("manifestSha256" ~ '^sha256:[a-f0-9]{64}$'),
  "requestWire" BYTEA NOT NULL,
  "requestByteLength" INTEGER NOT NULL,
  "requestWireSha256" VARCHAR(71) NOT NULL CHECK ("requestWireSha256" ~ '^sha256:[a-f0-9]{64}$'),
  "validationEvidenceWire" BYTEA NOT NULL,
  "validationEvidenceByteLength" INTEGER NOT NULL,
  "validationEvidenceSha256" VARCHAR(71) NOT NULL CHECK ("validationEvidenceSha256" ~ '^sha256:[a-f0-9]{64}$'),
  "toolArtifactId" VARCHAR(64) NOT NULL REFERENCES "SdkGrowthV3ToolArtifact"("artifactId") ON DELETE RESTRICT,
  "recordedAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE ("scopeKey", "epoch"),
  FOREIGN KEY ("scopeKey", "epoch") REFERENCES "SdkGrowthOwnerVersion"("scopeKey", "epoch") ON DELETE RESTRICT,
  CONSTRAINT "SdkGrowthV3ApprovedManifest_lengths" CHECK (
    "manifestByteLength" = octet_length("manifestWire") AND "manifestByteLength" BETWEEN 1 AND 1048576 AND
    "requestByteLength" = octet_length("requestWire") AND "requestByteLength" BETWEEN 1 AND 1048576 AND
    "validationEvidenceByteLength" = octet_length("validationEvidenceWire") AND
    "validationEvidenceByteLength" BETWEEN 1 AND 65536
  ),
  CONSTRAINT "SdkGrowthV3ApprovedManifest_digests" CHECK (
    "manifestSha256" = 'sha256:' || encode(sha256("manifestWire"), 'hex') AND
    "requestWireSha256" = 'sha256:' || encode(sha256("requestWire"), 'hex') AND
    "validationEvidenceSha256" = 'sha256:' || encode(sha256("validationEvidenceWire"), 'hex') AND
    "manifestId" = encode(
      sha256(convert_to('reviewrouter:g1-approved-v3-manifest:1', 'UTF8') || '\x00'::bytea || "manifestWire"),
      'hex'
    )
  )
);
CREATE TRIGGER sdk_growth_v3_manifest_immutable
  BEFORE UPDATE OR DELETE ON "SdkGrowthV3ApprovedManifest"
  FOR EACH ROW EXECUTE FUNCTION sdk_growth_snapshot_immutable();
CREATE TRIGGER sdk_growth_v3_manifest_no_truncate
  BEFORE TRUNCATE ON "SdkGrowthV3ApprovedManifest"
  FOR EACH STATEMENT EXECUTE FUNCTION sdk_growth_snapshot_immutable();

ALTER TABLE "SdkGrowthApprovalFact"
  ADD COLUMN "v3ManifestId" VARCHAR(64) REFERENCES "SdkGrowthV3ApprovedManifest"("manifestId") ON DELETE RESTRICT;
ALTER TABLE "SdkGrowthApprovalFact" DROP CONSTRAINT "SdkGrowthApprovalFact_shape";
ALTER TABLE "SdkGrowthApprovalFact" ADD CONSTRAINT "SdkGrowthApprovalFact_shape" CHECK (
  ("action" = 'approve' AND "proposalReference" IS NOT NULL AND "approvalEpoch" IS NULL AND
    (("record" IS NOT NULL AND "v3ManifestId" IS NULL) OR
     ("record" IS NULL AND "v3ManifestId" IS NOT NULL)))
  OR ("action" = 'revoke' AND "record" IS NULL AND "proposalReference" IS NULL AND
      "approvalEpoch" IS NOT NULL AND "v3ManifestId" IS NULL)
);

-- Existing SQL113 fact guard is extended, preserving every v1 check. A v3
-- fact requires the immutable manifest and authority facts at the same epoch.
CREATE OR REPLACE FUNCTION sdk_growth_approval_fact_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE current_epoch BIGINT; pointer_writer BIGINT; approval_action TEXT;
DECLARE authority_binding JSONB; authority_evidence JSONB; authority_provenance JSONB;
DECLARE authority_reason TEXT; authority_installation_active BOOLEAN; authority_verifier_active BOOLEAN;
DECLARE binding_writer BIGINT; owner_writer BIGINT;
DECLARE original_record JSONB; original_manifest_id VARCHAR(64);
DECLARE manifest_scope TEXT; manifest_epoch BIGINT; manifest_json JSONB; request_json JSONB;
BEGIN
  EXECUTE format('SELECT "epoch", "lastWriteXid" FROM %I.%I WHERE "scopeKey" = $1',
    TG_TABLE_SCHEMA, 'SdkGrowthCurrentAuthority')
    INTO current_epoch, pointer_writer USING NEW."scopeKey";
  IF current_epoch IS DISTINCT FROM NEW."epoch" OR pointer_writer IS NULL OR
     pointer_writer IS DISTINCT FROM pg_current_xact_id()::text::bigint THEN
    RAISE EXCEPTION 'approval fact requires authority epoch advance';
  END IF;
  EXECUTE format(
    'SELECT b."binding", o."evidence", o."provenance", o."reason", o."installationActive", o."verifierActive", b."lastWriteXid", o."lastWriteXid" FROM %I.%I b JOIN %I.%I o ON o."scopeKey" = b."scopeKey" AND o."epoch" = b."epoch" WHERE b."scopeKey" = $1 AND b."epoch" = $2',
    TG_TABLE_SCHEMA, 'SdkGrowthBindingVersion', TG_TABLE_SCHEMA, 'SdkGrowthOwnerVersion')
    INTO authority_binding, authority_evidence, authority_provenance, authority_reason,
      authority_installation_active, authority_verifier_active, binding_writer, owner_writer
    USING NEW."scopeKey", NEW."epoch";
  IF NEW."action" = 'approve' AND NEW."v3ManifestId" IS NOT NULL THEN
    EXECUTE format('SELECT "scopeKey", "epoch", convert_from("manifestWire", ''UTF8'')::jsonb, convert_from("requestWire", ''UTF8'')::jsonb FROM %I.%I WHERE "manifestId" = $1',
      TG_TABLE_SCHEMA, 'SdkGrowthV3ApprovedManifest')
      INTO manifest_scope, manifest_epoch, manifest_json, request_json USING NEW."v3ManifestId";
    IF manifest_scope IS DISTINCT FROM NEW."scopeKey" OR manifest_epoch IS DISTINCT FROM NEW."epoch" OR
       binding_writer IS DISTINCT FROM pg_current_xact_id()::text::bigint OR
       owner_writer IS DISTINCT FROM pg_current_xact_id()::text::bigint OR
       authority_reason NOT IN ('provision', 'binding-replacement', 'owner-replacement') OR
       manifest_json->'ef'->'binding' IS DISTINCT FROM authority_binding OR
       request_json->'binding' IS DISTINCT FROM authority_binding OR
       manifest_json->'approval' IS DISTINCT FROM authority_evidence OR
       manifest_json->'provenance' IS DISTINCT FROM authority_provenance OR
       authority_installation_active IS DISTINCT FROM TRUE OR authority_verifier_active IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'v3 approval manifest does not match authority version';
    END IF;
  ELSIF NEW."action" = 'approve' THEN
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
    EXECUTE format('SELECT "action", "record", "v3ManifestId" FROM %I.%I WHERE "scopeKey" = $1 AND "epoch" = $2',
      TG_TABLE_SCHEMA, 'SdkGrowthApprovalFact')
      INTO approval_action, original_record, original_manifest_id USING NEW."scopeKey", NEW."approvalEpoch";
    IF original_manifest_id IS NOT NULL THEN
      EXECUTE format('SELECT convert_from("manifestWire", ''UTF8'')::jsonb FROM %I.%I WHERE "manifestId" = $1',
        TG_TABLE_SCHEMA, 'SdkGrowthV3ApprovedManifest')
        INTO manifest_json USING original_manifest_id;
      IF approval_action IS DISTINCT FROM 'approve' OR authority_reason IS DISTINCT FROM 'owner-revocation' OR
         binding_writer IS DISTINCT FROM pg_current_xact_id()::text::bigint OR
         owner_writer IS DISTINCT FROM pg_current_xact_id()::text::bigint OR
         NEW."approvalEpoch" <> NEW."epoch" - 1 OR
         manifest_json->'ef'->'binding' IS DISTINCT FROM authority_binding OR
         jsonb_set(manifest_json->'approval', '{revoked}', 'true'::jsonb, false) IS DISTINCT FROM authority_evidence OR
         manifest_json->'provenance' IS DISTINCT FROM authority_provenance OR
         authority_installation_active IS DISTINCT FROM TRUE OR authority_verifier_active IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'v3 revocation must reference matching active approval';
      END IF;
    ELSE
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
  END IF;
  RETURN NULL;
END;
$$;

-- A bare manifest cannot be installed and attached to a later approval.
CREATE FUNCTION sdk_growth_v3_manifest_fact_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE fact_id VARCHAR(64); current_epoch BIGINT; pointer_writer BIGINT;
BEGIN
  EXECUTE format('SELECT "v3ManifestId" FROM %I.%I WHERE "scopeKey" = $1 AND "epoch" = $2 AND "action" = ''approve''',
    TG_TABLE_SCHEMA, 'SdkGrowthApprovalFact') INTO fact_id USING NEW."scopeKey", NEW."epoch";
  EXECUTE format('SELECT "epoch", "lastWriteXid" FROM %I.%I WHERE "scopeKey" = $1',
    TG_TABLE_SCHEMA, 'SdkGrowthCurrentAuthority') INTO current_epoch, pointer_writer USING NEW."scopeKey";
  IF fact_id IS DISTINCT FROM NEW."manifestId" OR current_epoch IS DISTINCT FROM NEW."epoch" OR
     pointer_writer IS DISTINCT FROM pg_current_xact_id()::text::bigint THEN
    RAISE EXCEPTION 'v3 manifest requires same-transaction approval';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER sdk_growth_v3_manifest_fact_advance
  AFTER INSERT ON "SdkGrowthV3ApprovedManifest"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION sdk_growth_v3_manifest_fact_guard();
REVOKE ALL ON FUNCTION sdk_growth_v3_manifest_fact_guard() FROM PUBLIC;
