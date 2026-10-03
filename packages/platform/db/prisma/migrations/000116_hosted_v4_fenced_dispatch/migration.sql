BEGIN;
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

-- Relay leases are a separate authority domain. The v4 request/effect gate
-- installed in 107 stays closed until bounded transport admission exists.
ALTER TYPE "ReviewInvestigationLeasePurposeV1" ADD VALUE 'relay_turn';
ALTER TYPE "ReviewContextLeaseAuthorityKindV1" ADD VALUE 'investigation_relay';

ALTER TABLE "ReviewInvestigationTurn"
  ADD COLUMN "turnBudgetCanonicalJson" TEXT,
  ADD COLUMN "turnBudgetHash" TEXT,
  ADD CONSTRAINT "ReviewInvestigationTurn_budget_pair" CHECK (
    ("turnBudgetCanonicalJson" IS NULL) = ("turnBudgetHash" IS NULL)
  ),
  ADD CONSTRAINT "ReviewInvestigationTurn_budget_hash" CHECK (
    "turnBudgetHash" IS NULL OR "turnBudgetHash" ~ '^[a-f0-9]{64}$'
  ),
  ADD CONSTRAINT "ReviewInvestigationTurn_budget_size" CHECK (
    "turnBudgetCanonicalJson" IS NULL OR length("turnBudgetCanonicalJson") <= 2048
  );

-- The original received-state check requires a null hash because v1 hashes
-- the body after admission. V4 must persist the hash of the admitted bytes in
-- the same insert that consumes the request slot. Preserve v1's rule.
ALTER TABLE "HostedCodexRelayRequest"
  DROP CONSTRAINT "HostedCodexRelayRequest_status_evidence_check";
ALTER TABLE "HostedCodexRelayRequest"
  ADD CONSTRAINT "HostedCodexRelayRequest_status_evidence_check" CHECK (
    ("status" = 'received' AND "startedAt" IS NULL AND "completedAt" IS NULL
      AND "successfulResponseStartedAt" IS NULL
      AND (("authorityKind" = 'v1_comment' AND "requestHash" IS NULL)
        OR ("authorityKind" = 'v4_relay_turn' AND "requestHash" IS NOT NULL))
      AND "responseBytes" IS NULL AND "responseHash" IS NULL AND "errorCode" IS NULL)
    OR ("status" = 'processing' AND "startedAt" IS NOT NULL AND "completedAt" IS NULL
      AND "successfulResponseStartedAt" IS NULL AND "responseBytes" IS NULL
      AND "responseHash" IS NULL AND "errorCode" IS NULL)
    OR ("status" = 'response_started' AND "startedAt" IS NOT NULL
      AND "successfulResponseStartedAt" IS NOT NULL AND "completedAt" IS NULL
      AND "requestHash" IS NOT NULL AND "responseBytes" IS NOT NULL
      AND "responseBytes" >= 0 AND "responseHash" IS NULL AND "errorCode" IS NULL)
    OR ("status" = 'succeeded' AND "startedAt" IS NOT NULL AND "completedAt" IS NOT NULL
      AND "successfulResponseStartedAt" IS NOT NULL AND "requestHash" IS NOT NULL
      AND "responseBytes" >= 0 AND "responseHash" IS NOT NULL AND "errorCode" IS NULL)
    OR ("status" = 'failed' AND "requestHash" IS NOT NULL
      AND "completedAt" IS NOT NULL AND "errorCode" IS NOT NULL)
    OR ("status" = 'terminal_unknown' AND "completedAt" IS NOT NULL
      AND "errorCode" IS NOT NULL)
  );

CREATE FUNCTION public.review_investigation_turn_budget_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $guard$
BEGIN
  IF NEW."turnBudgetCanonicalJson" IS DISTINCT FROM OLD."turnBudgetCanonicalJson"
     OR NEW."turnBudgetHash" IS DISTINCT FROM OLD."turnBudgetHash" THEN
    RAISE EXCEPTION 'review_investigation_turn_budget_immutable';
  END IF;
  RETURN NEW;
END $guard$;
REVOKE ALL ON FUNCTION public.review_investigation_turn_budget_guard() FROM PUBLIC;
CREATE TRIGGER review_investigation_turn_budget_guard_trigger
  BEFORE UPDATE ON "ReviewInvestigationTurn"
  FOR EACH ROW EXECUTE FUNCTION public.review_investigation_turn_budget_guard();

-- A grant already consumes this relay turn's allocation, even before the first
-- request. Abort/expiry cannot hide that reservation and open a replacement.
-- A completed turn needs real terminal evidence.
CREATE FUNCTION public.review_investigation_v4_request_fence()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $guard$
BEGIN
  IF NEW."state" IS DISTINCT FROM OLD."state" AND EXISTS (
    SELECT 1 FROM public."HostedCodexV4RelayTurn" v
    JOIN public."HostedCodexInvocationGrant" g ON g."v4TurnKey" = v."logicalTurnKey"
    WHERE v."investigationId" = OLD."investigationId" AND v."turnId" = OLD."turnId"
      AND g."authorityKind" = 'v4_relay_turn'
      AND NOT (NEW."state" = 'committed' AND NEW."acceptedAttestationId" IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public."HostedCodexRelayRequest" r
          JOIN public."HostedCodexUpstreamEffectAttempt" e
            ON e."relayRequestId" = r."id" AND e."grantId" = g."id"
          WHERE r."grantId" = g."id" AND r."authorityKind" = 'v4_relay_turn'
            AND r."status" = 'succeeded' AND e."authorityKind" = 'v4_relay_turn'
            AND e."state" = 'succeeded'
        ))
  ) THEN
    RAISE EXCEPTION 'review_investigation_v4_request_unresolved';
  END IF;
  RETURN NEW;
END $guard$;
REVOKE ALL ON FUNCTION public.review_investigation_v4_request_fence() FROM PUBLIC;
CREATE TRIGGER review_investigation_v4_request_fence_trigger
  BEFORE UPDATE OF "state" ON "ReviewInvestigationTurn"
  FOR EACH ROW EXECUTE FUNCTION public.review_investigation_v4_request_fence();

-- A prepared reservation is durable while paid dispatch remains closed. The
-- legacy v1 path keeps the 107 authority separation. A later, qualified
-- transport must add its own fenced dispatch transition; this migration does
-- not authorize a provider send.
CREATE OR REPLACE FUNCTION public.hosted_codex_v4_dispatch_disabled()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
SET timezone = 'UTC' AS $guard$
DECLARE
  grant_row public."HostedCodexInvocationGrant"%ROWTYPE;
  turn_row public."HostedCodexV4RelayTurn"%ROWTYPE;
  investigation_turn_row public."ReviewInvestigationTurn"%ROWTYPE;
  request_row public."HostedCodexRelayRequest"%ROWTYPE;
BEGIN
  SELECT * INTO grant_row FROM public."HostedCodexInvocationGrant"
    WHERE "id" = NEW."grantId" FOR UPDATE;
  IF NOT FOUND OR NEW."authorityKind" IS DISTINCT FROM grant_row."authorityKind" THEN
    RAISE EXCEPTION 'hosted_v4_relay_authority_mismatch';
  END IF;
  IF grant_row."authorityKind" = 'v1_comment' THEN
    IF TG_OP = 'UPDATE' AND NEW."authorityKind" IS DISTINCT FROM OLD."authorityKind" THEN
      RAISE EXCEPTION 'hosted_relay_request_authority_immutable';
    END IF;
    RETURN NEW;
  END IF;
  IF grant_row."authorityKind" <> 'v4_relay_turn' OR grant_row."v4TurnKey" IS NULL THEN
    RAISE EXCEPTION 'hosted_v4_relay_authority_mismatch';
  END IF;
  SELECT * INTO turn_row FROM public."HostedCodexV4RelayTurn"
    WHERE "logicalTurnKey" = grant_row."v4TurnKey" FOR UPDATE;
  IF NOT FOUND OR turn_row."scopeHash" IS DISTINCT FROM grant_row."v4ScopeHash" THEN
    RAISE EXCEPTION 'hosted_v4_relay_turn_mismatch';
  END IF;
  IF TG_TABLE_NAME = 'HostedCodexRelayRequest' THEN
    IF TG_OP = 'INSERT' THEN
      SELECT * INTO investigation_turn_row FROM public."ReviewInvestigationTurn"
        WHERE "turnId" = turn_row."turnId" AND "investigationId" = turn_row."investigationId"
        FOR UPDATE;
      -- The existing admission trigger has already consumed one request slot.
      IF turn_row."state" <> 'open' OR turn_row."expiresAt" <= clock_timestamp() OR
         NEW."status" <> 'received' OR NEW."ordinal" <> 1 OR
         NEW."requestHash" IS NULL OR NEW."requestHash" !~ '^[a-f0-9]{64}$' OR
         NEW."requestBytes" < 1 OR NEW."requestBytes" > turn_row."maxRequestBytes" OR
         grant_row."requestCount" <> 1 OR grant_row."inFlight" <> 1 OR
         grant_row."maxRequests" <> 1 OR
         NOT FOUND OR investigation_turn_row."state" <> 'leased' OR
         investigation_turn_row."expiresAt" <= clock_timestamp() OR
         investigation_turn_row."turnBudgetCanonicalJson" IS NULL OR
         investigation_turn_row."turnBudgetHash" IS DISTINCT FROM
           (turn_row."scopeCanonical"::jsonb ->> 'turnBudgetHash') OR
         investigation_turn_row."turnBudgetCanonicalJson" IS DISTINCT FROM
           (turn_row."scopeCanonical"::jsonb ->> 'turnBudgetCanonicalJson') OR
         NOT EXISTS (
           SELECT 1 FROM public."ReviewMutationAuthority" m
           WHERE m."scmRepositoryIdentityId" =
             (turn_row."scopeCanonical"::jsonb ->> 'scmRepositoryIdentityId')
             AND m."laneKind" = 'hosted_reviewrouter_app'
             AND m."mode" = 'v2_active'
             AND m."epoch"::text = (turn_row."scopeCanonical"::jsonb ->> 'mutationEpoch')
           FOR SHARE
         ) OR
         NOT EXISTS (
           SELECT 1 FROM public."ReviewExecutionStreamV2" s
           JOIN public."ReviewExecutionV2" x ON x."executionId" = s."activeExecutionId"
           WHERE s."workspaceId" = (turn_row."scopeCanonical"::jsonb ->> 'workspaceId')
             AND s."repositoryConnectionId" =
               (turn_row."scopeCanonical"::jsonb ->> 'repositoryConnectionId')
             AND s."scmRepositoryIdentityId" =
               (turn_row."scopeCanonical"::jsonb ->> 'scmRepositoryIdentityId')
             AND s."pullRequestNumber" =
               (turn_row."scopeCanonical"::jsonb ->> 'pullRequestNumber')::integer
             AND s."activeExecutionId" = (turn_row."scopeCanonical"::jsonb ->> 'executionId')
             AND s."preparedExecutionId" IS NULL
             AND s."lastAllocatedGeneration" = x."generation"
             AND s."currentReviewRevisionHash" =
               (turn_row."scopeCanonical"::jsonb ->> 'reviewRevisionHash')
           FOR SHARE OF s
         ) OR
         NOT EXISTS (
           SELECT 1 FROM public."ReviewRunAuthorization" a
           WHERE a."authorizationId" = turn_row."authorizationId"
             AND a."authorizationId" = (turn_row."scopeCanonical"::jsonb ->> 'authorizationId')
             AND a."state" = 'active' AND a."expiresAt" > clock_timestamp()
             AND a."mutationEpoch"::text = (turn_row."scopeCanonical"::jsonb ->> 'mutationEpoch')
             AND a."reviewRevisionHash" = (turn_row."scopeCanonical"::jsonb ->> 'reviewRevisionHash')
             AND a."headSha" = (turn_row."scopeCanonical"::jsonb ->> 'headSha')
             AND a."producerReleaseId" = (turn_row."scopeCanonical"::jsonb ->> 'producerReleaseId')
         ) OR
         NOT EXISTS (
           SELECT 1 FROM public."ReviewInvestigationLease" l
           WHERE l."leaseId" = (turn_row."scopeCanonical"::jsonb #>> '{investigationLease,leaseId}')
             AND l."purpose" = 'relay_turn' AND l."state" = 'active'
             AND l."expiresAt" > clock_timestamp()
             AND l."authorizationId" = turn_row."authorizationId"
             AND l."investigationId" = turn_row."investigationId"
             AND l."turnId" = turn_row."turnId"
             AND l."mutationEpoch"::text = (turn_row."scopeCanonical"::jsonb ->> 'mutationEpoch')
             AND l."leaseCapabilityId" = (turn_row."scopeCanonical"::jsonb #>> '{investigationLease,capabilityId}')
             AND l."ownerIdHash" = (turn_row."scopeCanonical"::jsonb #>> '{investigationLease,ownerIdHash}')
             AND l."fencingToken"::text = (turn_row."scopeCanonical"::jsonb #>> '{investigationLease,fencingToken}')
         ) OR
         NOT EXISTS (
           SELECT 1 FROM public."ReviewInvocationLeaseV2" l
           WHERE l."leaseId" = (turn_row."scopeCanonical"::jsonb #>> '{invocationLease,leaseId}')
             AND l."purpose" = 'provider_execution' AND l."state" = 'active'
             AND l."expiresAt" > clock_timestamp()
             AND l."authorizationId" = turn_row."authorizationId"
             AND l."executionId" = (turn_row."scopeCanonical"::jsonb ->> 'executionId')
             AND l."workSlotId" = (turn_row."scopeCanonical"::jsonb ->> 'workSlotId')
             AND l."mutationEpoch"::text = (turn_row."scopeCanonical"::jsonb ->> 'mutationEpoch')
             AND l."leaseCapabilityId" = (turn_row."scopeCanonical"::jsonb #>> '{invocationLease,capabilityId}')
             AND l."ownerIdHash" = (turn_row."scopeCanonical"::jsonb #>> '{invocationLease,ownerIdHash}')
             AND l."fencingToken"::text = (turn_row."scopeCanonical"::jsonb #>> '{invocationLease,fencingToken}')
         ) THEN
        RAISE EXCEPTION 'hosted_v4_relay_request_reservation_denied';
      END IF;
    ELSIF NEW."authorityKind" IS DISTINCT FROM OLD."authorityKind" OR
          (turn_row."state" = 'terminal_unknown' AND
           NEW."status" <> 'terminal_unknown') OR
          OLD."status" = 'failed' AND NEW."status" = 'processing' OR
          (NEW."status" IS DISTINCT FROM OLD."status" AND
           NEW."status" NOT IN ('terminal_unknown', 'failed')) THEN
      RAISE EXCEPTION 'hosted_v4_relay_request_transition_denied';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME <> 'HostedCodexUpstreamEffectAttempt' THEN
    RAISE EXCEPTION 'hosted_v4_relay_table_invalid';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO request_row FROM public."HostedCodexRelayRequest"
      WHERE "id" = NEW."relayRequestId" AND "grantId" = NEW."grantId" FOR UPDATE;
    IF NOT FOUND OR turn_row."state" <> 'open' OR
       turn_row."expiresAt" <= clock_timestamp() OR
       grant_row."status" <> 'exhausted' OR
       grant_row."requestCount" <> 1 OR grant_row."inFlight" <> 1 OR
       request_row."authorityKind" <> 'v4_relay_turn' OR
       request_row."status" <> 'received' OR
       request_row."requestHash" IS DISTINCT FROM NEW."requestHash" OR
       request_row."idempotencyKeyHash" IS DISTINCT FROM NEW."idempotencyKeyHash" OR
       NEW."state" <> 'prepared' OR NEW."attemptOrdinal" <> 1 OR
       NEW."accountId" IS DISTINCT FROM grant_row."activeAccountId" OR
       NEW."accountId" IS DISTINCT FROM grant_row."primaryAccountId" OR
       NEW."credentialGeneration" IS NULL OR
       NOT EXISTS (
         SELECT 1 FROM public."HostedCodexAccount" a
         WHERE a."id" = NEW."accountId" AND a."workspaceId" = NEW."workspaceId"
           AND a."poolId" = NEW."poolId" AND a."state" = 'healthy'
           AND a."activeGeneration" = NEW."credentialGeneration"
       ) THEN
      RAISE EXCEPTION 'hosted_v4_relay_effect_reservation_denied';
    END IF;
  ELSIF NEW."authorityKind" IS DISTINCT FROM OLD."authorityKind" OR
        NEW."credentialGeneration" IS DISTINCT FROM OLD."credentialGeneration" OR
        (turn_row."state" = 'terminal_unknown' AND
         NEW."state" <> 'terminal_unknown') OR
        (NEW."state" IS DISTINCT FROM OLD."state" AND
         NEW."state" NOT IN ('terminal_unknown', 'failed_no_effect')) OR
        (NEW."state" = 'failed_no_effect' AND OLD."state" <> 'failed_no_effect' AND
         (OLD."state" <> 'prepared' OR OLD."dispatchStartedAt" IS NOT NULL OR
          OLD."responseStartedAt" IS NOT NULL OR OLD."completedAt" IS NOT NULL)) OR
        (OLD."state" = 'terminal_unknown' AND NEW."state" <> OLD."state") THEN
    RAISE EXCEPTION 'hosted_v4_relay_paid_dispatch_unqualified';
  END IF;
  RETURN NEW;
END $guard$;
REVOKE ALL ON FUNCTION public.hosted_codex_v4_dispatch_disabled() FROM PUBLIC;

COMMIT;
