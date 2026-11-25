BEGIN;
ALTER TABLE "ProducerRelease" ADD COLUMN "reviewerPlanProfile" JSONB;
ALTER TABLE "ProducerRelease" ADD CONSTRAINT "ProducerRelease_reviewer_plan_profile_check" CHECK (
  "reviewerPlanProfile" IS NULL OR (
    jsonb_typeof("reviewerPlanProfile") = 'object' AND
    "reviewerPlanProfile" ?& ARRAY['planVersion', 'descriptorDigest'] AND
    "reviewerPlanProfile" - ARRAY['planVersion', 'descriptorDigest'] = '{}'::jsonb AND
    "reviewerPlanProfile" -> 'planVersion' = '1'::jsonb AND
    "reviewerPlanProfile" ->> 'descriptorDigest' ~ '^sha256:[a-f0-9]{64}$') IS TRUE);
CREATE FUNCTION review_reviewer_plan_profile_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."reviewerPlanProfile" IS DISTINCT FROM OLD."reviewerPlanProfile" THEN
    RAISE EXCEPTION 'producer_reviewer_plan_profile_immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ProducerRelease_reviewer_plan_profile_immutable"
BEFORE UPDATE ON "ProducerRelease" FOR EACH ROW EXECUTE FUNCTION review_reviewer_plan_profile_immutable();

-- Keep the exact independent historical envelope; only v4 gets the larger bound.
ALTER TABLE "ReviewRunAuthorization" DROP CONSTRAINT "ReviewRunAuthorization_runtime_snapshot_bound";
ALTER TABLE "ReviewRunAuthorization" ADD CONSTRAINT "ReviewRunAuthorization_runtime_snapshot_bound" CHECK (
 "runtimeSnapshotCanonicalJson" IS NULL OR (
  (octet_length("runtimeSnapshotCanonicalJson") BETWEEN 2 AND 32768 AND
   jsonb_typeof("runtimeSnapshotCanonicalJson"::jsonb) = 'object' AND
   "runtimeSnapshotCanonicalJson"::jsonb ->> 'snapshotVersion' IN ('1', '2', '3') AND
   ("runtimeSnapshotCanonicalJson"::jsonb ->> 'snapshotVersion' = '1' OR
    ("runtimeSnapshotCanonicalJson"::jsonb ->> 'snapshotVersion' = '3' AND NOT ("runtimeSnapshotCanonicalJson"::jsonb -> 'gateway' ? 'expectedAuthorizationEpoch')) OR
    CASE WHEN jsonb_typeof("runtimeSnapshotCanonicalJson"::jsonb #> '{gateway,expectedAuthorizationEpoch}') = 'number' AND ("runtimeSnapshotCanonicalJson"::jsonb #>> '{gateway,expectedAuthorizationEpoch}') ~ '^[1-9][0-9]{0,15}$'
    THEN ("runtimeSnapshotCanonicalJson"::jsonb #>> '{gateway,expectedAuthorizationEpoch}')::numeric BETWEEN 1 AND 9007199254740991 ELSE false END)) OR
  (octet_length("runtimeSnapshotCanonicalJson") BETWEEN 2 AND 131072 AND
   jsonb_typeof("runtimeSnapshotCanonicalJson"::jsonb) = 'object' AND
   "runtimeSnapshotCanonicalJson"::jsonb -> 'snapshotVersion' = '4'::jsonb AND
   NOT ("runtimeSnapshotCanonicalJson"::jsonb ?| ARRAY['agent', 'agentProfileDigest', 'gateway']) AND
   jsonb_typeof("runtimeSnapshotCanonicalJson"::jsonb -> 'reviewers') = 'array' AND
   jsonb_array_length("runtimeSnapshotCanonicalJson"::jsonb -> 'reviewers') BETWEEN 1 AND 16 AND
   jsonb_typeof("runtimeSnapshotCanonicalJson"::jsonb -> 'allocations') = 'array' AND
   jsonb_array_length("runtimeSnapshotCanonicalJson"::jsonb -> 'allocations') BETWEEN 1 AND 16)
 ) IS TRUE);

CREATE TABLE "ReviewRunGatewayAllocationExecution" (
 "authorizationId" TEXT NOT NULL,
 "allocationId" TEXT NOT NULL,
 "gatewayExecutionCanonicalJson" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "cleanupCompletedAt" TIMESTAMP(3),
 CONSTRAINT "ReviewRunGatewayAllocationExecution_pkey" PRIMARY KEY ("authorizationId", "allocationId"),
 CONSTRAINT "ReviewRunGatewayAllocationExecution_authorizationId_fkey" FOREIGN KEY ("authorizationId") REFERENCES "ReviewRunAuthorization"("authorizationId") ON DELETE CASCADE ON UPDATE NO ACTION,
 CONSTRAINT "ReviewRunGatewayAllocationExecution_allocation_check" CHECK ("allocationId" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'),
 CONSTRAINT "ReviewRunGatewayAllocationExecution_binding_check" CHECK (
  (octet_length("gatewayExecutionCanonicalJson") BETWEEN 2 AND 2048 AND
   jsonb_typeof("gatewayExecutionCanonicalJson"::jsonb) = 'object' AND
   "gatewayExecutionCanonicalJson"::jsonb ?& ARRAY['bindingVersion', 'operationId', 'executionRef', 'accountRef', 'authorizationEpoch', 'deadline'] AND
   "gatewayExecutionCanonicalJson"::jsonb - ARRAY['bindingVersion', 'operationId', 'executionRef', 'accountRef', 'authorizationEpoch', 'deadline'] = '{}'::jsonb AND
   "gatewayExecutionCanonicalJson"::jsonb -> 'bindingVersion' = '1'::jsonb AND
   "gatewayExecutionCanonicalJson"::jsonb ->> 'operationId' ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' AND
   "gatewayExecutionCanonicalJson"::jsonb ->> 'executionRef' ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' AND
   "gatewayExecutionCanonicalJson"::jsonb ->> 'accountRef' ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' AND
   "gatewayExecutionCanonicalJson"::jsonb ->> 'authorizationEpoch' ~ '^[0-9]{1,16}$' AND
   ("gatewayExecutionCanonicalJson"::jsonb ->> 'authorizationEpoch')::numeric BETWEEN 0 AND 9007199254740991) IS TRUE)
);
CREATE INDEX "ReviewRunGatewayAllocationExecution_cleanupCompletedAt_idx" ON "ReviewRunGatewayAllocationExecution"("cleanupCompletedAt", "authorizationId");

CREATE FUNCTION review_run_gateway_allocation_execution_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent "ReviewRunAuthorization"%ROWTYPE; snapshot jsonb; allocation jsonb; selected jsonb; caps jsonb; cap_name text; matches integer;
BEGIN
 IF TG_OP = 'DELETE' THEN
  IF EXISTS (SELECT 1 FROM "ReviewRunAuthorization" WHERE "authorizationId" = OLD."authorizationId") THEN
   RAISE EXCEPTION 'review_run_gateway_allocation_execution_delete_forbidden' USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
 END IF;
 IF TG_OP = 'UPDATE' THEN
  IF ROW(NEW."authorizationId", NEW."allocationId", NEW."gatewayExecutionCanonicalJson", NEW."createdAt") IS DISTINCT FROM
     ROW(OLD."authorizationId", OLD."allocationId", OLD."gatewayExecutionCanonicalJson", OLD."createdAt") OR
     (OLD."cleanupCompletedAt" IS NOT NULL AND NEW."cleanupCompletedAt" IS DISTINCT FROM OLD."cleanupCompletedAt") THEN
   RAISE EXCEPTION 'review_run_gateway_allocation_execution_immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO parent FROM "ReviewRunAuthorization" WHERE "authorizationId" = NEW."authorizationId" FOR UPDATE;
 IF NOT FOUND OR parent."state" <> 'active' OR parent."expiresAt" <= (clock_timestamp() AT TIME ZONE 'UTC') OR parent."maxExpiresAt" <= (clock_timestamp() AT TIME ZONE 'UTC') OR NEW."cleanupCompletedAt" IS NOT NULL THEN
  RAISE EXCEPTION 'review_run_gateway_allocation_parent_not_live' USING ERRCODE = '23514';
 END IF;
 snapshot := parent."runtimeSnapshotCanonicalJson"::jsonb;
 IF snapshot -> 'snapshotVersion' IS DISTINCT FROM '4'::jsonb OR parent."gatewayExecutionCanonicalJson" IS NOT NULL THEN
  RAISE EXCEPTION 'review_run_gateway_allocation_v4_required' USING ERRCODE = '23514';
 END IF;
 SELECT count(*), jsonb_agg(item) -> 0 INTO matches, allocation FROM jsonb_array_elements(snapshot -> 'allocations') item WHERE item ->> 'allocationId' = NEW."allocationId";
 selected := NEW."gatewayExecutionCanonicalJson"::jsonb;
 caps := allocation -> 'limits';
 IF matches <> 1 OR (selected ->> 'operationId' = allocation ->> 'operationId' AND
   selected ->> 'accountRef' = allocation ->> 'permittedAccountRef' AND
   selected ->> 'deadline' = snapshot ->> 'deadline' AND
   ((selected ->> 'deadline')::timestamptz AT TIME ZONE 'UTC') = parent."maxExpiresAt" AND
   (NOT (allocation ? 'expectedAuthorizationEpoch') OR selected -> 'authorizationEpoch' = allocation -> 'expectedAuthorizationEpoch') AND
   jsonb_typeof(caps) = 'object' AND caps ?& ARRAY['requests', 'concurrency', 'requestBytes', 'outputBytes', 'tokens'] AND
   caps - ARRAY['requests', 'concurrency', 'requestBytes', 'outputBytes', 'tokens'] = '{}'::jsonb) IS NOT TRUE THEN
  RAISE EXCEPTION 'review_run_gateway_allocation_exact_authority_required' USING ERRCODE = '23514';
 END IF;
 FOREACH cap_name IN ARRAY ARRAY['requests', 'concurrency', 'requestBytes', 'outputBytes', 'tokens'] LOOP
  IF (jsonb_typeof(caps -> cap_name) = 'number' AND (caps ->> cap_name) ~ '^[1-9][0-9]{0,15}$' AND (caps ->> cap_name)::numeric BETWEEN 1 AND 9007199254740991) IS NOT TRUE THEN
   RAISE EXCEPTION 'review_run_gateway_allocation_caps_required' USING ERRCODE = '23514';
  END IF;
 END LOOP;
 RETURN NEW;
END;
$$;
CREATE TRIGGER "ReviewRunGatewayAllocationExecution_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ReviewRunGatewayAllocationExecution" FOR EACH ROW EXECUTE FUNCTION review_run_gateway_allocation_execution_guard();

CREATE FUNCTION review_run_gateway_allocation_parent_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN
  IF EXISTS (SELECT 1 FROM "ReviewRunGatewayAllocationExecution" WHERE "authorizationId" = OLD."authorizationId" AND "cleanupCompletedAt" IS NULL) THEN
   RAISE EXCEPTION 'review_run_gateway_allocation_cleanup_pending' USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
 END IF;
 IF EXISTS (SELECT 1 FROM "ReviewRunGatewayAllocationExecution" WHERE "authorizationId" = OLD."authorizationId") AND
  ROW(NEW."authorizationId", NEW."workspaceId", NEW."repositoryConnectionId", NEW."scmRepositoryIdentityId", NEW."pullRequestNumber", NEW."sourceRunId", NEW."sourceRunAttempt", NEW."workflowIdentityHash", NEW."baseSha", NEW."mergeBaseSha", NEW."headSha", NEW."reviewRevisionHash", NEW."trustDomain", NEW."maxExpiresAt", NEW."runtimeSnapshotCanonicalJson") IS DISTINCT FROM
  ROW(OLD."authorizationId", OLD."workspaceId", OLD."repositoryConnectionId", OLD."scmRepositoryIdentityId", OLD."pullRequestNumber", OLD."sourceRunId", OLD."sourceRunAttempt", OLD."workflowIdentityHash", OLD."baseSha", OLD."mergeBaseSha", OLD."headSha", OLD."reviewRevisionHash", OLD."trustDomain", OLD."maxExpiresAt", OLD."runtimeSnapshotCanonicalJson") THEN
  RAISE EXCEPTION 'review_run_gateway_allocation_parent_immutable' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER "ReviewRunAuthorization_allocation_parent_guard" BEFORE UPDATE OR DELETE ON "ReviewRunAuthorization" FOR EACH ROW EXECUTE FUNCTION review_run_gateway_allocation_parent_guard();
COMMIT;
