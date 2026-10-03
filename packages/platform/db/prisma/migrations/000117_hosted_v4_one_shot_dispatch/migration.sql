BEGIN;
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

-- Keep the certified 116 INSERT gate verbatim. Only UPDATE gets the new,
-- approval-bound lifecycle; ordinary V4 turns remain paid-dispatch disabled.
CREATE FUNCTION public.hosted_codex_v4_one_shot_update_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
SET timezone = 'UTC' AS $guard$
DECLARE
  grant_row public."HostedCodexInvocationGrant"%ROWTYPE;
  turn_row public."HostedCodexV4RelayTurn"%ROWTYPE;
  request_row public."HostedCodexRelayRequest"%ROWTYPE;
  effect_row public."HostedCodexUpstreamEffectAttempt"%ROWTYPE;
  scope jsonb;
  approval jsonb;
BEGIN
  SELECT * INTO grant_row FROM public."HostedCodexInvocationGrant"
    WHERE "id" = NEW."grantId" FOR UPDATE;
  IF NOT FOUND OR NEW."authorityKind" IS DISTINCT FROM grant_row."authorityKind"
     OR NEW."authorityKind" IS DISTINCT FROM OLD."authorityKind" THEN
    RAISE EXCEPTION 'hosted_v4_relay_authority_mismatch';
  END IF;
  IF grant_row."authorityKind" = 'v1_comment' THEN RETURN NEW; END IF;
  IF grant_row."authorityKind" <> 'v4_relay_turn' THEN
    RAISE EXCEPTION 'hosted_v4_relay_authority_mismatch';
  END IF;
  SELECT * INTO turn_row FROM public."HostedCodexV4RelayTurn"
    WHERE "logicalTurnKey" = grant_row."v4TurnKey" FOR UPDATE;
  IF NOT FOUND OR turn_row."scopeHash" IS DISTINCT FROM grant_row."v4ScopeHash" THEN
    RAISE EXCEPTION 'hosted_v4_relay_turn_mismatch';
  END IF;
  IF TG_TABLE_NAME = 'HostedCodexRelayRequest' THEN
    IF turn_row."state" = 'terminal_unknown' AND NEW."status" <> 'terminal_unknown' THEN
      RAISE EXCEPTION 'hosted_v4_relay_request_transition_denied';
    END IF;
    -- Preserve 116's no-effect/unknown recovery, never a paid replay.
    IF NEW."status" IN ('terminal_unknown', 'failed') THEN RETURN NEW; END IF;
    IF NEW."status" = OLD."status" AND NEW."status" = 'received' THEN RETURN NEW; END IF;
    request_row := NEW;
    SELECT * INTO effect_row FROM public."HostedCodexUpstreamEffectAttempt"
      WHERE "relayRequestId" = NEW."id" AND "grantId" = NEW."grantId"
        AND "attemptOrdinal" = 1 FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'hosted_v4_relay_effect_missing'; END IF;
  ELSIF TG_TABLE_NAME = 'HostedCodexUpstreamEffectAttempt' THEN
    IF NEW."credentialGeneration" IS DISTINCT FROM OLD."credentialGeneration"
       OR (turn_row."state" = 'terminal_unknown' AND NEW."state" <> 'terminal_unknown') THEN
      RAISE EXCEPTION 'hosted_v4_relay_paid_dispatch_unqualified';
    END IF;
    IF NEW."state" = 'terminal_unknown' THEN RETURN NEW; END IF;
    IF NEW."state" = 'failed_no_effect' THEN
      IF OLD."state" <> 'failed_no_effect' AND
         (OLD."state" <> 'prepared' OR OLD."dispatchStartedAt" IS NOT NULL
          OR OLD."responseStartedAt" IS NOT NULL OR OLD."completedAt" IS NOT NULL) THEN
        RAISE EXCEPTION 'hosted_v4_relay_paid_dispatch_unqualified';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW."state" = OLD."state" AND NEW."state" = 'prepared' THEN RETURN NEW; END IF;
    IF OLD."leaseExpiresAt" <= clock_timestamp() THEN
      RAISE EXCEPTION 'hosted_v4_relay_dispatch_owner_expired';
    END IF;
    IF NOT COALESCE((NEW."state" = 'dispatching' AND NEW."dispatchStartedAt" IS NOT NULL
          AND NEW."responseStartedAt" IS NULL AND NEW."completedAt" IS NULL)
        OR (NEW."state" = 'response_started' AND NEW."dispatchStartedAt" IS NOT NULL
          AND NEW."responseStartedAt" IS NOT NULL AND NEW."completedAt" IS NULL)
        OR (NEW."state" = 'succeeded' AND NEW."dispatchStartedAt" IS NOT NULL
          AND NEW."responseStartedAt" IS NOT NULL AND NEW."completedAt" IS NOT NULL
          AND NEW."terminalEvidenceHash" ~ '^[a-f0-9]{64}$'), false) THEN
      RAISE EXCEPTION 'hosted_v4_relay_dispatch_evidence_missing';
    END IF;
    effect_row := NEW;
    SELECT * INTO request_row FROM public."HostedCodexRelayRequest"
      WHERE "id" = NEW."relayRequestId" AND "grantId" = NEW."grantId" FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'hosted_v4_relay_request_missing'; END IF;
  ELSE RAISE EXCEPTION 'hosted_v4_relay_table_invalid';
  END IF;
  scope := turn_row."scopeCanonical"::jsonb;
  approval := scope -> 'ownerOneShotApproval';
  IF NOT COALESCE(
    turn_row."state" = 'open' AND turn_row."expiresAt" > clock_timestamp()
    AND grant_row."status" = 'exhausted' AND grant_row."expiresAt" > clock_timestamp()
    AND grant_row."requestCount" = 1 AND grant_row."inFlight" = 1
    AND grant_row."maxRequests" = 1 AND grant_row."maxConcurrentRequests" = 1
    AND grant_row."backupAccountId" IS NULL
    AND grant_row."activeAccountId" = grant_row."primaryAccountId"
    AND scope ->> 'githubRepositoryId' = '1252762369'
    AND approval ->> 'purpose' = 'owner_one_shot_uncapped_test'
    AND approval ->> 'githubRepositoryId' = '1252762369'
    AND approval ->> 'accountId' = grant_row."activeAccountId"
    AND approval ->> 'grantId' = grant_row."id"
    AND approval ->> 'approvalHash' ~ '^[a-f0-9]{64}$'
    AND approval ->> 'unapprovedScopeHash' ~ '^[a-f0-9]{64}$'
    AND approval ->> 'sourceCommit' ~ '^[a-f0-9]{40}$'
    AND (approval ->> 'expiresAt')::timestamptz > clock_timestamp()
    AND (approval ->> 'expiresAt')::timestamptz <= turn_row."expiresAt"
    AND approval ->> 'requestHash' = request_row."requestHash"
    AND approval ->> 'idempotencyKeyHash' = request_row."idempotencyKeyHash"
    AND request_row."authorityKind" = 'v4_relay_turn' AND request_row."ordinal" = 1
    AND effect_row."authorityKind" = 'v4_relay_turn' AND effect_row."attemptOrdinal" = 1
    AND effect_row."requestHash" = request_row."requestHash"
    AND effect_row."idempotencyKeyHash" = request_row."idempotencyKeyHash"
    AND effect_row."accountId" = grant_row."activeAccountId"
    AND effect_row."leaseExpiresAt" > clock_timestamp()
    AND EXISTS (SELECT 1 FROM public."ProducerRelease" p
      WHERE p."producerReleaseId" = scope ->> 'producerReleaseId' AND p."state" = 'registered' FOR SHARE)
    AND EXISTS (SELECT 1 FROM public."ReviewRunAuthorization" a
      WHERE a."authorizationId" = scope ->> 'authorizationId'
        AND a."state" = 'active' AND a."expiresAt" > clock_timestamp()
        AND a."mutationEpoch"::text = scope ->> 'mutationEpoch'
        AND a."headSha" = scope ->> 'headSha'
        AND a."reviewRevisionHash" = scope ->> 'reviewRevisionHash' FOR SHARE)
    AND EXISTS (SELECT 1 FROM public."ReviewMutationAuthority" m
      WHERE m."scmRepositoryIdentityId" = scope ->> 'scmRepositoryIdentityId'
        AND m."laneKind" = 'hosted_reviewrouter_app' AND m."mode" = 'v2_active'
        AND m."epoch"::text = scope ->> 'mutationEpoch' FOR SHARE)
    AND EXISTS (SELECT 1 FROM public."ReviewInvestigationTurn" t
      WHERE t."investigationId" = turn_row."investigationId" AND t."turnId" = turn_row."turnId"
        AND t."state" = 'leased' AND t."expiresAt" > clock_timestamp()
        AND t."turnBudgetHash" = scope ->> 'turnBudgetHash' FOR SHARE)
    AND EXISTS (SELECT 1 FROM public."ReviewExecutionStreamV2" s
      JOIN public."ReviewExecutionV2" x ON x."executionId" = s."activeExecutionId"
      WHERE s."activeExecutionId" = scope ->> 'executionId'
        AND s."scmRepositoryIdentityId" = scope ->> 'scmRepositoryIdentityId'
        AND s."pullRequestNumber" = (scope ->> 'pullRequestNumber')::integer
        AND s."preparedExecutionId" IS NULL AND s."lastAllocatedGeneration" = x."generation"
        AND x."state" = 'running'
        AND s."currentReviewRevisionHash" = scope ->> 'reviewRevisionHash' FOR SHARE OF s)
    AND EXISTS (SELECT 1 FROM public."HostedCodexRepositoryBinding" b
      JOIN public."HostedCodexPool" p ON p."id" = b."poolId"
      WHERE b."id" = scope ->> 'repositoryBindingId' AND b."status" = 'active'
        AND b."revision"::text = scope ->> 'bindingRevision' AND p."status" = 'active'
        AND p."authzEpoch"::text = scope ->> 'poolAuthzEpoch' FOR SHARE OF b, p)
    AND EXISTS (SELECT 1 FROM public.hosted_historical_lock_runtime_gate() g
      WHERE g."status" = 'active' AND g."authzEpoch"::text = scope ->> 'runtimeAuthzEpoch')
    AND EXISTS (SELECT 1 FROM public."ReviewInvestigationLease" l
      WHERE l."leaseId" = scope #>> '{investigationLease,leaseId}' AND l."purpose" = 'relay_turn'
        AND l."state" = 'active' AND l."expiresAt" > clock_timestamp()
        AND l."ownerIdHash" = scope #>> '{investigationLease,ownerIdHash}'
        AND l."fencingToken"::text = scope #>> '{investigationLease,fencingToken}'
        AND l."leaseCapabilityId" = scope #>> '{investigationLease,capabilityId}' FOR SHARE)
    AND EXISTS (SELECT 1 FROM public."ReviewInvocationLeaseV2" l
      WHERE l."leaseId" = scope #>> '{invocationLease,leaseId}' AND l."purpose" = 'provider_execution'
        AND l."state" = 'active' AND l."expiresAt" > clock_timestamp()
        AND l."ownerIdHash" = scope #>> '{invocationLease,ownerIdHash}'
        AND l."fencingToken"::text = scope #>> '{invocationLease,fencingToken}'
        AND l."leaseCapabilityId" = scope #>> '{invocationLease,capabilityId}' FOR SHARE)
    AND EXISTS (SELECT 1 FROM public."HostedCodexAccount" a
      WHERE a."id" = effect_row."accountId" AND a."state" = 'healthy'
        AND a."activeGeneration" = effect_row."credentialGeneration" FOR SHARE)
  , false) THEN RAISE EXCEPTION 'hosted_v4_relay_paid_dispatch_unqualified'; END IF;
  IF TG_TABLE_NAME = 'HostedCodexRelayRequest' THEN
    IF NOT ((OLD."status" = 'received' AND NEW."status" = 'processing' AND effect_row."state" = 'prepared')
      OR (OLD."status" = 'processing' AND NEW."status" = 'response_started' AND effect_row."state" = 'dispatching')
      OR (OLD."status" = 'response_started' AND NEW."status" = 'succeeded' AND effect_row."state" = 'succeeded')) THEN
      RAISE EXCEPTION 'hosted_v4_relay_request_transition_denied';
    END IF;
  ELSIF NOT ((OLD."state" = 'prepared' AND NEW."state" = 'dispatching' AND request_row."status" = 'processing')
    OR (OLD."state" = 'dispatching' AND NEW."state" = 'response_started' AND request_row."status" = 'response_started')
    OR (OLD."state" = 'response_started' AND NEW."state" = 'succeeded' AND request_row."status" = 'response_started')
    OR (OLD."state" = NEW."state" AND NEW."state" IN ('dispatching', 'response_started'))) THEN
    RAISE EXCEPTION 'hosted_v4_relay_paid_dispatch_unqualified';
  END IF;
  RETURN NEW;
END $guard$;
REVOKE ALL ON FUNCTION public.hosted_codex_v4_one_shot_update_guard() FROM PUBLIC;

DROP TRIGGER hosted_codex_v4_request_dispatch_guard_trigger ON public."HostedCodexRelayRequest";
DROP TRIGGER hosted_codex_v4_effect_dispatch_guard_trigger ON public."HostedCodexUpstreamEffectAttempt";
CREATE TRIGGER hosted_codex_v4_request_dispatch_guard_trigger
  BEFORE INSERT ON public."HostedCodexRelayRequest"
  FOR EACH ROW EXECUTE FUNCTION public.hosted_codex_v4_dispatch_disabled();
CREATE TRIGGER hosted_codex_v4_effect_dispatch_guard_trigger
  BEFORE INSERT ON public."HostedCodexUpstreamEffectAttempt"
  FOR EACH ROW EXECUTE FUNCTION public.hosted_codex_v4_dispatch_disabled();
CREATE TRIGGER hosted_codex_v4_request_one_shot_update_guard_trigger
  BEFORE UPDATE ON public."HostedCodexRelayRequest"
  FOR EACH ROW EXECUTE FUNCTION public.hosted_codex_v4_one_shot_update_guard();
CREATE TRIGGER hosted_codex_v4_effect_one_shot_update_guard_trigger
  BEFORE UPDATE ON public."HostedCodexUpstreamEffectAttempt"
  FOR EACH ROW EXECUTE FUNCTION public.hosted_codex_v4_one_shot_update_guard();
COMMIT;
