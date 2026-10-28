-- Inert H C3 format foundation. Capture/public personal consumption remain disabled.
-- Preserve SQL120 immutability, SQL121 selected shape and SQL128 narrow API ACL.
BEGIN;

ALTER TABLE "ReviewRunAuthorization" DROP CONSTRAINT "ReviewRunAuthorization_runtime_snapshot_bound";
ALTER TABLE "ReviewRunAuthorization" ADD CONSTRAINT "ReviewRunAuthorization_runtime_snapshot_bound"
CHECK ("runtimeSnapshotCanonicalJson" IS NULL OR (
  octet_length("runtimeSnapshotCanonicalJson") BETWEEN 2 AND 32768
  AND jsonb_typeof("runtimeSnapshotCanonicalJson"::jsonb) = 'object'
  AND (
    "runtimeSnapshotCanonicalJson"::jsonb -> 'snapshotVersion' = '1'::jsonb
    OR ("runtimeSnapshotCanonicalJson"::jsonb -> 'snapshotVersion' = '2'::jsonb AND
      CASE WHEN jsonb_typeof("runtimeSnapshotCanonicalJson"::jsonb #> '{gateway,expectedAuthorizationEpoch}') = 'number'
        AND ("runtimeSnapshotCanonicalJson"::jsonb #>> '{gateway,expectedAuthorizationEpoch}') ~ '^[1-9][0-9]{0,15}$'
      THEN ("runtimeSnapshotCanonicalJson"::jsonb #>> '{gateway,expectedAuthorizationEpoch}')::numeric BETWEEN 1 AND 9007199254740991
      ELSE false END)
  )
) IS TRUE);

CREATE OR REPLACE FUNCTION review_run_gateway_execution_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  selected jsonb;
  original jsonb;
  caps jsonb;
  cap_name text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."gatewayExecutionCanonicalJson" IS NOT NULL THEN
      RAISE EXCEPTION 'review_run_gateway_execution_requires_existing_authority' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."gatewayExecutionCanonicalJson" IS NOT NULL AND
     NEW."gatewayExecutionCanonicalJson" IS DISTINCT FROM OLD."gatewayExecutionCanonicalJson" THEN
    RAISE EXCEPTION 'review_run_gateway_execution_immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."gatewayExecutionCanonicalJson" IS NOT NULL THEN
    IF ROW(NEW."authorizationId", NEW."workspaceId", NEW."repositoryConnectionId",
           NEW."scmRepositoryIdentityId", NEW."pullRequestNumber", NEW."sourceRunId",
           NEW."sourceRunAttempt", NEW."workflowIdentityHash", NEW."baseSha", NEW."mergeBaseSha",
           NEW."headSha", NEW."reviewRevisionHash", NEW."trustDomain", NEW."maxExpiresAt",
           NEW."runtimeSnapshotCanonicalJson") IS DISTINCT FROM
       ROW(OLD."authorizationId", OLD."workspaceId", OLD."repositoryConnectionId",
           OLD."scmRepositoryIdentityId", OLD."pullRequestNumber", OLD."sourceRunId",
           OLD."sourceRunAttempt", OLD."workflowIdentityHash", OLD."baseSha", OLD."mergeBaseSha",
           OLD."headSha", OLD."reviewRevisionHash", OLD."trustDomain", OLD."maxExpiresAt",
           OLD."runtimeSnapshotCanonicalJson") THEN
      RAISE EXCEPTION 'review_run_gateway_execution_owner_immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW."gatewayExecutionCanonicalJson" IS NULL OR OLD."gatewayExecutionCanonicalJson" IS NOT NULL THEN
    RETURN NEW;
  END IF;
  selected := NEW."gatewayExecutionCanonicalJson"::jsonb;
  original := NEW."runtimeSnapshotCanonicalJson"::jsonb;
  caps := original #> '{gateway,limits}';
  IF (NEW."state" = 'active' AND NEW."expiresAt" > (clock_timestamp() AT TIME ZONE 'UTC')
      AND NEW."maxExpiresAt" > (clock_timestamp() AT TIME ZONE 'UTC')
      AND (original -> 'snapshotVersion' = '1'::jsonb OR
        (original -> 'snapshotVersion' = '2'::jsonb AND
          CASE WHEN jsonb_typeof(original #> '{gateway,expectedAuthorizationEpoch}') = 'number'
            AND (original #>> '{gateway,expectedAuthorizationEpoch}') ~ '^[1-9][0-9]{0,15}$'
          THEN (original #>> '{gateway,expectedAuthorizationEpoch}')::numeric BETWEEN 1 AND 9007199254740991
            AND selected -> 'authorizationEpoch' = original #> '{gateway,expectedAuthorizationEpoch}'
          ELSE false END))
      AND jsonb_typeof(original -> 'gateway') = 'object'
      AND selected ->> 'operationId' = original #>> '{gateway,operationId}'
      AND selected ->> 'accountRef' = original #>> '{gateway,permittedAccountRef}'
      AND selected ->> 'deadline' = original ->> 'deadline'
      AND ((original ->> 'deadline')::timestamptz AT TIME ZONE 'UTC') = NEW."maxExpiresAt"
      AND jsonb_typeof(caps) = 'object'
      AND caps ?& ARRAY['requests', 'concurrency', 'requestBytes', 'outputBytes', 'tokens']
      AND caps - ARRAY['requests', 'concurrency', 'requestBytes', 'outputBytes', 'tokens'] = '{}'::jsonb
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'review_run_gateway_execution_original_authority_required' USING ERRCODE = '23514';
  END IF;
  FOREACH cap_name IN ARRAY ARRAY['requests', 'concurrency', 'requestBytes', 'outputBytes', 'tokens'] LOOP
    IF (jsonb_typeof(caps -> cap_name) = 'number'
        AND (caps ->> cap_name) ~ '^[1-9][0-9]{0,15}$'
        AND (caps ->> cap_name)::numeric BETWEEN 1 AND 9007199254740991) IS NOT TRUE THEN
      RAISE EXCEPTION 'review_run_gateway_execution_approved_caps_required' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

COMMIT;
