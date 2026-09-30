-- Dormant G1 TEST-only v3 request-validation custody. Deployment grants INSERT
-- only to the protected verifier producer; candidate roles get no privileges.
CREATE TABLE "SdkGrowthV3RequestEvidence" (
  "evidenceId" VARCHAR(64) NOT NULL UNIQUE,
  "assignmentId" TEXT NOT NULL REFERENCES "SdkGrowthVerifierAssignment"("assignmentId") ON DELETE RESTRICT,
  "operation" TEXT NOT NULL CHECK ("operation" = 'check'),
  "stage" TEXT NOT NULL CHECK ("stage" = 'request-validation'),
  "scopeKey" TEXT NOT NULL,
  "approvalEpoch" BIGINT NOT NULL CHECK ("approvalEpoch" > 0),
  "manifestId" VARCHAR(64) NOT NULL REFERENCES "SdkGrowthV3ApprovedManifest"("manifestId") ON DELETE RESTRICT,
  "ownerEvidenceId" TEXT NOT NULL CHECK (length("ownerEvidenceId") BETWEEN 1 AND 512),
  "efToolArtifactId" VARCHAR(64) NOT NULL REFERENCES "SdkGrowthV3ToolArtifact"("artifactId") ON DELETE RESTRICT,
  "firstJti" VARCHAR(128) NOT NULL CHECK (length("firstJti") BETWEEN 1 AND 128),
  "tokenIssuedAtMs" BIGINT NOT NULL CHECK ("tokenIssuedAtMs" > 0),
  "tokenExpiresAtMs" BIGINT NOT NULL CHECK ("tokenExpiresAtMs" > "tokenIssuedAtMs"),
  "requestWire" BYTEA NOT NULL,
  "requestByteLength" INTEGER NOT NULL,
  "requestWireSha256" VARCHAR(71) NOT NULL CHECK ("requestWireSha256" ~ '^sha256:[a-f0-9]{64}$'),
  -- EF protocol digest is deliberately separate from the SHA of exact bytes.
  "efRequestDigest" VARCHAR(71) NOT NULL CHECK ("efRequestDigest" ~ '^sha256:[a-f0-9]{64}$'),
  "validationEvidenceWire" BYTEA NOT NULL,
  "validationEvidenceByteLength" INTEGER NOT NULL,
  "validationEvidenceSha256" VARCHAR(71) NOT NULL CHECK ("validationEvidenceSha256" ~ '^sha256:[a-f0-9]{64}$'),
  "recordedAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY ("assignmentId", "operation", "stage"),
  FOREIGN KEY ("scopeKey", "approvalEpoch") REFERENCES "SdkGrowthApprovalFact"("scopeKey", "epoch") ON DELETE RESTRICT,
  CONSTRAINT "SdkGrowthV3RequestEvidence_slot" CHECK (
    "assignmentId" ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' AND
    "evidenceId" = encode(sha256(
      convert_to('reviewrouter:g1-v3-request-slot:1', 'UTF8') || '\x00'::bytea ||
      convert_to(format('["%s","%s","%s"]', "assignmentId", "operation", "stage"), 'UTF8')
    ), 'hex')
  ),
  CONSTRAINT "SdkGrowthV3RequestEvidence_bytes" CHECK (
    "requestByteLength" = octet_length("requestWire") AND "requestByteLength" BETWEEN 1 AND 1048576 AND
    "validationEvidenceByteLength" = octet_length("validationEvidenceWire") AND
    "validationEvidenceByteLength" BETWEEN 1 AND 65536
  ),
  CONSTRAINT "SdkGrowthV3RequestEvidence_digests" CHECK (
    "requestWireSha256" = 'sha256:' || encode(sha256("requestWire"), 'hex') AND
    "validationEvidenceSha256" = 'sha256:' || encode(sha256("validationEvidenceWire"), 'hex')
  )
);
REVOKE ALL ON TABLE "SdkGrowthV3RequestEvidence" FROM PUBLIC;
CREATE INDEX "SdkGrowthV3RequestEvidence_approval_idx"
  ON "SdkGrowthV3RequestEvidence" ("scopeKey", "approvalEpoch");

-- Narrow owner-held read lock for the producer's early authority check.
-- The evidence trigger below independently repeats this check at write time.
CREATE FUNCTION public.sdk_growth_v3_request_current_lock(p_scope_key text)
RETURNS TABLE (
  "epoch" bigint,
  "evidence" jsonb,
  "installationActive" boolean,
  "verifierActive" boolean
)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $function$
  SELECT c."epoch", o."evidence", o."installationActive", o."verifierActive"
  FROM public."SdkGrowthCurrentAuthority" AS c
  JOIN public."SdkGrowthOwnerVersion" AS o
    ON o."scopeKey" = c."scopeKey" AND o."epoch" = c."epoch"
  WHERE c."scopeKey" = p_scope_key
  FOR SHARE OF c
$function$;
REVOKE ALL ON FUNCTION public.sdk_growth_v3_request_current_lock(text) FROM PUBLIC;
-- Grant EXECUTE only to the isolated verifier producer role at deployment.

CREATE TRIGGER sdk_growth_v3_request_evidence_immutable
  BEFORE UPDATE OR DELETE ON "SdkGrowthV3RequestEvidence"
  FOR EACH ROW EXECUTE FUNCTION sdk_growth_snapshot_immutable();
CREATE TRIGGER sdk_growth_v3_request_evidence_no_truncate
  BEFORE TRUNCATE ON "SdkGrowthV3RequestEvidence"
  FOR EACH STATEMENT EXECUTE FUNCTION sdk_growth_snapshot_immutable();

-- The immediate pass takes row locks in a fixed order. The deferred pass
-- rechecks all facts at transaction end, including same-transaction revocation.
CREATE FUNCTION sdk_growth_v3_request_evidence_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE assignment_execution JSONB; assignment_created TIMESTAMPTZ;
DECLARE assignment_expires TIMESTAMPTZ; assignment_revoked TIMESTAMPTZ;
DECLARE assignment_tool VARCHAR(64); current_epoch BIGINT; owner_evidence JSONB;
DECLARE owner_provenance JSONB; installation_active BOOLEAN; verifier_active BOOLEAN;
DECLARE approval_action TEXT; approval_manifest VARCHAR(64);
DECLARE manifest_scope TEXT; manifest_epoch BIGINT; manifest_tool VARCHAR(64);
DECLARE manifest_request BYTEA; manifest_json JSONB; request_json JSONB;
DECLARE validation_json JSONB; now_at TIMESTAMPTZ; now_ms BIGINT;
BEGIN
  EXECUTE format('SELECT "execution", "createdAt", "expiresAt", "revokedAt", "efToolArtifactId" FROM %I.%I WHERE "assignmentId" = $1 FOR SHARE',
    TG_TABLE_SCHEMA, 'SdkGrowthVerifierAssignment')
    INTO assignment_execution, assignment_created, assignment_expires, assignment_revoked, assignment_tool
    USING NEW."assignmentId";
  IF assignment_execution IS NULL THEN RAISE EXCEPTION 'v3 request assignment missing'; END IF;

  EXECUTE format('SELECT "epoch" FROM %I.%I WHERE "scopeKey" = $1 FOR SHARE',
    TG_TABLE_SCHEMA, 'SdkGrowthCurrentAuthority')
    INTO current_epoch USING NEW."scopeKey";
  IF current_epoch IS NULL THEN RAISE EXCEPTION 'v3 request authority missing'; END IF;

  EXECUTE format('SELECT o."evidence", o."provenance", o."installationActive", o."verifierActive", f."action", f."v3ManifestId" FROM %I.%I o JOIN %I.%I f ON f."scopeKey" = o."scopeKey" AND f."epoch" = o."epoch" WHERE o."scopeKey" = $1 AND o."epoch" = $2',
    TG_TABLE_SCHEMA, 'SdkGrowthOwnerVersion', TG_TABLE_SCHEMA, 'SdkGrowthApprovalFact')
    INTO owner_evidence, owner_provenance, installation_active, verifier_active,
      approval_action, approval_manifest USING NEW."scopeKey", NEW."approvalEpoch";
  IF owner_evidence IS NULL THEN RAISE EXCEPTION 'v3 request approval missing'; END IF;

  EXECUTE format('SELECT "scopeKey", "epoch", "toolArtifactId", "requestWire", convert_from("manifestWire", ''UTF8'')::jsonb FROM %I.%I WHERE "manifestId" = $1',
    TG_TABLE_SCHEMA, 'SdkGrowthV3ApprovedManifest')
    INTO manifest_scope, manifest_epoch, manifest_tool, manifest_request, manifest_json
    USING NEW."manifestId";
  IF manifest_scope IS NULL THEN RAISE EXCEPTION 'v3 request manifest missing'; END IF;

  now_at := clock_timestamp();
  now_ms := floor(extract(epoch FROM now_at) * 1000)::bigint;
  IF current_epoch IS DISTINCT FROM NEW."approvalEpoch" OR
     approval_action IS DISTINCT FROM 'approve' OR approval_manifest IS DISTINCT FROM NEW."manifestId" OR
     manifest_scope IS DISTINCT FROM NEW."scopeKey" OR manifest_epoch IS DISTINCT FROM NEW."approvalEpoch" OR
     owner_evidence->>'evidenceId' IS DISTINCT FROM NEW."ownerEvidenceId" OR
     owner_evidence->>'decision' IS DISTINCT FROM 'approved' OR
     owner_evidence->>'revoked' IS DISTINCT FROM 'false' OR
     owner_evidence->>'operation' IS DISTINCT FROM NEW."operation" OR
     owner_provenance->>'subject' IS DISTINCT FROM manifest_json->'approval'->>'ownerSubject' OR
     installation_active IS DISTINCT FROM TRUE OR verifier_active IS DISTINCT FROM TRUE OR
     (owner_evidence->>'expiresAt')::bigint <= now_ms OR
     (owner_evidence->>'issuedAt')::bigint > now_ms OR
     manifest_json->'approval' IS DISTINCT FROM owner_evidence OR
     manifest_json->'provenance' IS DISTINCT FROM owner_provenance THEN
    RAISE EXCEPTION 'v3 request approval is not current';
  END IF;

  IF assignment_revoked IS NOT NULL OR assignment_expires <= now_at OR
     assignment_tool IS DISTINCT FROM NEW."efToolArtifactId" OR
     manifest_tool IS DISTINCT FROM NEW."efToolArtifactId" OR
     manifest_json->'tool'->>'efToolArtifactId' IS DISTINCT FROM NEW."efToolArtifactId" OR
     assignment_execution->>'tenantId' IS DISTINCT FROM manifest_json->'scope'->>'tenantId' OR
     assignment_execution->>'repositoryId' IS DISTINCT FROM manifest_json->'scope'->>'repositoryId' OR
     assignment_execution->>'pullRequest' IS DISTINCT FROM manifest_json->'scope'->>'pullRequest' OR
     assignment_execution->>'githubRepositoryId' IS DISTINCT FROM manifest_json->'scope'->>'githubRepositoryId' OR
     assignment_execution->>'installationId' IS DISTINCT FROM manifest_json->'scope'->>'installationId' OR
     (manifest_json#>'{provenance,authorizedSubjects}' ? (assignment_execution->>'subject')) IS NOT TRUE OR
     assignment_execution->>'sourceCommit' IS DISTINCT FROM manifest_json#>>'{ef,binding,target,evaluation,commit}' OR
     assignment_execution->>'sourceTree' IS DISTINCT FROM manifest_json#>>'{ef,binding,target,evaluation,tree}' OR
     assignment_execution->>'sourceCommit' IS DISTINCT FROM manifest_json#>>'{ef,binding,target,head,commit}' OR
     assignment_execution->>'sourceTree' IS DISTINCT FROM manifest_json#>>'{ef,binding,target,head,tree}' OR
     manifest_json#>>'{ef,binding,target,evaluationKind}' IS DISTINCT FROM 'head' OR
     assignment_execution->>'verifierRevision' IS DISTINCT FROM manifest_json#>>'{ef,binding,verifier,immutableRevision}' OR
     assignment_execution#>>'{sourceBinding,baseCommit}' IS DISTINCT FROM manifest_json#>>'{ef,binding,target,base,commit}' OR
     assignment_execution#>>'{sourceBinding,baseTree}' IS DISTINCT FROM manifest_json#>>'{ef,binding,target,base,tree}' OR
     assignment_execution#>>'{sourceBinding,mergeBaseCommit}' IS DISTINCT FROM manifest_json#>>'{ef,binding,target,mergeBase,commit}' OR
     assignment_execution#>>'{sourceBinding,mergeBaseTree}' IS DISTINCT FROM manifest_json#>>'{ef,binding,target,mergeBase,tree}' OR
     assignment_execution#>>'{sourceBinding,headRepositoryId}' IS DISTINCT FROM manifest_json#>>'{ef,binding,target,repository,repositoryId}' OR
     assignment_execution#>>'{sourceBinding,baseRepositoryId}' IS DISTINCT FROM manifest_json#>>'{ef,binding,target,repository,repositoryId}' OR
     NEW."tokenIssuedAtMs" < floor(extract(epoch FROM assignment_created))::bigint * 1000 OR
     NEW."tokenIssuedAtMs" > now_ms OR NEW."tokenExpiresAtMs" <= now_ms OR
     NEW."tokenExpiresAtMs" > floor(extract(epoch FROM assignment_expires) * 1000)::bigint OR
     NEW."tokenExpiresAtMs" > NEW."tokenIssuedAtMs" + 300000 THEN
    RAISE EXCEPTION 'v3 request assignment or deadline mismatch';
  END IF;

  IF NEW."requestWire" IS DISTINCT FROM manifest_request THEN
    RAISE EXCEPTION 'v3 request bytes differ from approved manifest';
  END IF;
  request_json := convert_from(NEW."requestWire", 'UTF8')::jsonb;
  validation_json := convert_from(NEW."validationEvidenceWire", 'UTF8')::jsonb;
  IF request_json->>'operation' IS DISTINCT FROM NEW."operation" OR
     request_json->'binding' IS DISTINCT FROM manifest_json#>'{ef,binding}' OR
     validation_json->>'schema' IS DISTINCT FROM 'reviewrouter:g1-v3-request-validation-evidence:1' OR
     validation_json->>'requestWireSha256' IS DISTINCT FROM NEW."requestWireSha256" OR
     (validation_json->>'requestByteLength')::integer IS DISTINCT FROM NEW."requestByteLength" OR
     validation_json->>'protocolDigest' IS DISTINCT FROM NEW."efRequestDigest" OR
     validation_json->>'toolArtifactId' IS DISTINCT FROM NEW."efToolArtifactId" OR
     validation_json->>'result' IS DISTINCT FROM 'validated' THEN
    RAISE EXCEPTION 'v3 request validation evidence mismatch';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION sdk_growth_v3_request_evidence_guard() FROM PUBLIC;
CREATE TRIGGER sdk_growth_v3_request_evidence_check
  BEFORE INSERT ON "SdkGrowthV3RequestEvidence"
  FOR EACH ROW EXECUTE FUNCTION sdk_growth_v3_request_evidence_guard();
CREATE CONSTRAINT TRIGGER sdk_growth_v3_request_evidence_commit_check
  AFTER INSERT ON "SdkGrowthV3RequestEvidence"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION sdk_growth_v3_request_evidence_guard();
