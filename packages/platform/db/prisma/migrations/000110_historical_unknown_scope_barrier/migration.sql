BEGIN;
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

-- A stock standalone chain has no SaaS release roles. Only its trusted
-- migration administrator may establish the inert owner needed by the two
-- gate helpers. An existing role must already be safe; never repair one here.
DO $historical_owner$
DECLARE owner_role pg_catalog.pg_roles%ROWTYPE;
BEGIN
  SELECT * INTO owner_role FROM pg_catalog.pg_roles
    WHERE rolname = 'reviewrouter_release_schema_owner';
  IF NOT FOUND THEN
    IF current_user <> session_user OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles
      WHERE rolname = current_user AND rolsuper
    ) THEN
      RAISE EXCEPTION 'hosted_historical_owner_bootstrap_requires_administrator'
        USING ERRCODE = '42501';
    END IF;
    PERFORM pg_catalog.set_config('createrole_self_grant', '', true);
    CREATE ROLE reviewrouter_release_schema_owner NOLOGIN NOSUPERUSER
      NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS
      CONNECTION LIMIT -1;
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_auth_members edge
      WHERE edge.roleid = 'reviewrouter_release_schema_owner'::regrole
         OR edge.member = 'reviewrouter_release_schema_owner'::regrole
         OR edge.grantor = 'reviewrouter_release_schema_owner'::regrole
    ) THEN
      RAISE EXCEPTION 'hosted_historical_owner_bootstrap_membership'
        USING ERRCODE = '42501';
    END IF;
    -- Needed to resolve the definer's qualified public objects before a
    -- later managed handoff makes this role the owner of public itself.
    GRANT USAGE ON SCHEMA public TO reviewrouter_release_schema_owner;
  ELSE
    -- A preexisting owner must already resolve the qualified gate tables.
    IF owner_role.rolcanlogin OR owner_role.rolsuper OR owner_role.rolcreatedb
       OR owner_role.rolcreaterole OR owner_role.rolreplication
       OR owner_role.rolbypassrls OR owner_role.rolconnlimit <> -1
       OR owner_role.rolvaliduntil IS NOT NULL
       OR NOT pg_catalog.has_schema_privilege(
         'reviewrouter_release_schema_owner', 'public', 'USAGE')
       OR EXISTS (
         SELECT 1 FROM pg_catalog.pg_auth_members edge
         WHERE edge.roleid = owner_role.oid OR edge.member = owner_role.oid
            OR edge.grantor = owner_role.oid
       ) THEN
      RAISE EXCEPTION 'hosted_historical_owner_unsafe_existing_role'
        USING ERRCODE = '42501';
    END IF;
  END IF;
END $historical_owner$;

-- Installed inert. Only the offline migration owner may populate these tables,
-- and only while the runtime gate is closed. The API cannot self-clear a deny.
CREATE TABLE public."HostedHistoricalScopePolicy" (
  "id" text PRIMARY KEY CHECK ("id" = 'global'),
  "mode" text NOT NULL CHECK ("mode" = 'destination_required'),
  "databaseResourceIdentity" text NOT NULL CHECK (length("databaseResourceIdentity") >= 16),
  "databaseIncarnation" text NOT NULL CHECK (length("databaseIncarnation") >= 1),
  "receiptDigest" text NOT NULL CHECK ("receiptDigest" ~ '^[a-f0-9]{64}$'),
  "archiveDigest" text NOT NULL CHECK ("archiveDigest" ~ '^[a-f0-9]{64}$'),
  "expectedCount" integer NOT NULL CHECK ("expectedCount" > 0),
  "expectedSetDigest" text NOT NULL CHECK ("expectedSetDigest" ~ '^[a-f0-9]{64}$')
);
CREATE TABLE public."HostedHistoricalUnknownScope" (
  "id" text PRIMARY KEY,
  "githubRepositoryId" bigint NOT NULL CHECK ("githubRepositoryId" > 0),
  "pullRequestNumber" integer NOT NULL CHECK ("pullRequestNumber" > 0),
  "headSha" text NOT NULL CHECK ("headSha" ~ '^[a-f0-9]{40}$'),
  "providerFamily" text NOT NULL CHECK ("providerFamily" = 'codex_subscription_oauth_hosted_pool'),
  "sourceWorkspaceId" text NOT NULL,
  "sourceRepositoryConnectionId" text NOT NULL,
  "sourceScmRepositoryIdentityId" text NOT NULL,
  "sourceBaseSha" text NOT NULL CHECK ("sourceBaseSha" ~ '^[a-f0-9]{40}$'),
  "sourceMergeBaseSha" text NOT NULL CHECK ("sourceMergeBaseSha" ~ '^[a-f0-9]{40}$'),
  "sourceReviewRevisionHash" text NOT NULL CHECK ("sourceReviewRevisionHash" ~ '^[a-f0-9]{64}$'),
  "sourceProviderInstanceId" text NOT NULL,
  "sourceRunId" text NOT NULL,
  "sourceRunAttempt" text NOT NULL,
  "sourceWorkflowRef" text NOT NULL,
  "sourceBindingId" text NOT NULL,
  "sourceBindingRevision" bigint NOT NULL CHECK ("sourceBindingRevision" > 0),
  "sourceRuntimeAuthzEpoch" bigint,
  "sourceDatabaseIncarnation" text,
  "sourceRelayId" text NOT NULL,
  "sourceAttemptId" text,
  "cohort" text NOT NULL CHECK ("cohort" IN ('unknown_attempt', 'receipt_bound_orphan')),
  "receiptDigest" text NOT NULL CHECK ("receiptDigest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "HostedHistoricalUnknownScope_cohort_state_check" CHECK (
    ("cohort" = 'unknown_attempt' AND "sourceAttemptId" IS NOT NULL) OR
    ("cohort" = 'receipt_bound_orphan' AND "sourceAttemptId" IS NULL)
  ),
  UNIQUE ("sourceRelayId"),
  UNIQUE ("sourceAttemptId")
);
CREATE INDEX "HostedHistoricalUnknownScope_match_idx" ON public."HostedHistoricalUnknownScope"
  ("githubRepositoryId", "pullRequestNumber", "headSha", "providerFamily");
CREATE TABLE public."HostedHistoricalScopeAlias" (
  "scopeId" text NOT NULL REFERENCES public."HostedHistoricalUnknownScope"("id") ON DELETE RESTRICT,
  "kind" text NOT NULL CHECK ("kind" IN ('grant', 'grant_capability', 'refresh_capability', 'invocation', 'review_request', 'provider_invocation', 'provider_instance', 'run', 'workflow_source', 'relay_request', 'attempt')),
  "value" text NOT NULL,
  PRIMARY KEY ("scopeId", "kind", "value")
);
CREATE INDEX "HostedHistoricalScopeAlias_lookup_idx" ON public."HostedHistoricalScopeAlias" ("kind", "value");
CREATE TABLE public."HostedHistoricalScopeComplete" (
  "id" text PRIMARY KEY CHECK ("id" = 'global'),
  "databaseResourceIdentity" text NOT NULL,
  "databaseIncarnation" text NOT NULL,
  "receiptDigest" text NOT NULL,
  "archiveDigest" text NOT NULL,
  "memberCount" integer NOT NULL,
  "setDigest" text NOT NULL
);
ALTER TABLE public."HostedCodexInvocationGrant"
  ADD COLUMN "historicalGithubRepositoryId" bigint,
  ADD COLUMN "historicalPullRequestNumber" integer,
  ADD COLUMN "historicalHeadSha" text;

-- v1 serialization: jsonb positional arrays, UTF-8, C byte order, LF rows.
CREATE FUNCTION public.hosted_historical_set_digest() RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT encode(sha256(convert_to(coalesce((
    SELECT string_agg(jsonb_build_array(s."id", s."githubRepositoryId", s."pullRequestNumber",
      s."headSha", s."providerFamily", s."sourceWorkspaceId", s."sourceRepositoryConnectionId",
      s."sourceScmRepositoryIdentityId", s."sourceBaseSha", s."sourceMergeBaseSha",
      s."sourceReviewRevisionHash", s."sourceProviderInstanceId", s."sourceRunId",
      s."sourceRunAttempt", s."sourceWorkflowRef", s."sourceBindingId", s."sourceBindingRevision",
      s."sourceRuntimeAuthzEpoch", s."sourceDatabaseIncarnation",
      s."sourceRelayId", s."sourceAttemptId", s."cohort",
      s."receiptDigest", coalesce((SELECT jsonb_agg(jsonb_build_array(a."kind", a."value")
        ORDER BY a."kind" COLLATE "C", a."value" COLLATE "C") FROM public."HostedHistoricalScopeAlias" a
        WHERE a."scopeId" = s."id"), '[]'::jsonb))::text, E'\n' ORDER BY s."id" COLLATE "C")
    FROM public."HostedHistoricalUnknownScope" s
  ), ''), 'UTF8')), 'hex')
$$;

CREATE FUNCTION public.hosted_historical_setup_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'hosted_historical_import_requires_read_committed';
  END IF;
  IF session_user IN ('reviewrouter_api','reviewrouter_web','reviewrouter_worker',
      'reviewrouter_comment_token_custody','reviewrouter_codex_effect_authority')
     OR current_user IN ('reviewrouter_api','reviewrouter_web','reviewrouter_worker',
      'reviewrouter_comment_token_custody','reviewrouter_codex_effect_authority') THEN
    RAISE EXCEPTION 'hosted_historical_offline_owner_required';
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'hosted_historical_projection_immutable';
  END IF;
  -- The same row serializes import, completion, activation and grant insert.
  PERFORM 1 FROM public."HostedCodexRuntimeGate" WHERE "id" = 'global' AND "status" = 'closed' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'hosted_historical_setup_requires_closed_gate';
  END IF;
  IF EXISTS (SELECT 1 FROM public."HostedHistoricalScopeComplete" WHERE "id" = 'global') THEN
    RAISE EXCEPTION 'hosted_historical_set_already_complete';
  END IF;
  IF TG_TABLE_NAME = 'HostedHistoricalScopeComplete' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public."HostedHistoricalScopePolicy" p
      WHERE p."id" = 'global' AND p."mode" = 'destination_required'
        AND p."databaseResourceIdentity" = NEW."databaseResourceIdentity"
        AND p."databaseIncarnation" = NEW."databaseIncarnation"
        AND p."receiptDigest" = NEW."receiptDigest"
        AND p."archiveDigest" = NEW."archiveDigest"
        AND p."expectedCount" = NEW."memberCount"
        AND p."expectedSetDigest" = NEW."setDigest"
    ) OR NEW."memberCount" <> (SELECT count(*) FROM public."HostedHistoricalUnknownScope")
      OR NEW."setDigest" <> public.hosted_historical_set_digest()
      OR EXISTS (SELECT 1 FROM public."HostedHistoricalUnknownScope" s
                 WHERE s."receiptDigest" <> NEW."receiptDigest") THEN
      RAISE EXCEPTION 'hosted_historical_marker_incomplete_or_conflicting';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER hosted_historical_policy_immutable BEFORE INSERT OR UPDATE OR DELETE ON public."HostedHistoricalScopePolicy"
  FOR EACH ROW EXECUTE FUNCTION public.hosted_historical_setup_guard();
CREATE TRIGGER hosted_historical_scope_immutable BEFORE INSERT OR UPDATE OR DELETE ON public."HostedHistoricalUnknownScope"
  FOR EACH ROW EXECUTE FUNCTION public.hosted_historical_setup_guard();
CREATE TRIGGER hosted_historical_alias_immutable BEFORE INSERT OR UPDATE OR DELETE ON public."HostedHistoricalScopeAlias"
  FOR EACH ROW EXECUTE FUNCTION public.hosted_historical_setup_guard();
CREATE TRIGGER hosted_historical_marker_immutable BEFORE INSERT OR UPDATE OR DELETE ON public."HostedHistoricalScopeComplete"
  FOR EACH ROW EXECUTE FUNCTION public.hosted_historical_setup_guard();
CREATE TRIGGER hosted_historical_policy_no_truncate BEFORE TRUNCATE ON public."HostedHistoricalScopePolicy"
  FOR EACH STATEMENT EXECUTE FUNCTION public.hosted_historical_setup_guard();
CREATE TRIGGER hosted_historical_scope_no_truncate BEFORE TRUNCATE ON public."HostedHistoricalUnknownScope"
  FOR EACH STATEMENT EXECUTE FUNCTION public.hosted_historical_setup_guard();
CREATE TRIGGER hosted_historical_alias_no_truncate BEFORE TRUNCATE ON public."HostedHistoricalScopeAlias"
  FOR EACH STATEMENT EXECUTE FUNCTION public.hosted_historical_setup_guard();
CREATE TRIGGER hosted_historical_marker_no_truncate BEFORE TRUNCATE ON public."HostedHistoricalScopeComplete"
  FOR EACH STATEMENT EXECUTE FUNCTION public.hosted_historical_setup_guard();

CREATE FUNCTION public.hosted_historical_assert_ready() RETURNS boolean
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE p record;
BEGIN
  SELECT * INTO p FROM public."HostedHistoricalScopePolicy" WHERE "id" = 'global';
  IF NOT FOUND THEN RETURN true; END IF;
  IF NOT EXISTS (SELECT 1 FROM public."HostedHistoricalScopeComplete" m
    WHERE m."id" = 'global' AND m."databaseResourceIdentity" = p."databaseResourceIdentity"
      AND m."databaseIncarnation" = p."databaseIncarnation"
      AND m."receiptDigest" = p."receiptDigest" AND m."archiveDigest" = p."archiveDigest"
      AND m."memberCount" = p."expectedCount" AND m."setDigest" = p."expectedSetDigest")
    OR p."expectedCount" <> (SELECT count(*) FROM public."HostedHistoricalUnknownScope")
    OR p."expectedSetDigest" <> public.hosted_historical_set_digest() THEN
    RAISE EXCEPTION 'hosted_historical_marker_incomplete_or_conflicting';
  END IF;
  RETURN true;
END $$;

CREATE FUNCTION public.hosted_historical_assert_grant(g public."HostedCodexInvocationGrant") RETURNS boolean
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM public.hosted_historical_assert_ready();
  IF NOT EXISTS (SELECT 1 FROM public."HostedHistoricalScopePolicy" WHERE "id" = 'global') THEN RETURN true; END IF;
  IF EXISTS (SELECT 1 FROM public."HostedHistoricalScopeAlias" a
      WHERE (a."kind" = 'grant' AND a."value" = g."id")
        OR (a."kind" = 'grant_capability' AND a."value" = g."capabilityTokenHash")
        OR (a."kind" = 'invocation' AND a."value" = g."invocationId")
        OR (a."kind" = 'review_request' AND a."value" = g."reviewRequestId")
        OR (a."kind" = 'provider_invocation' AND a."value" = g."providerInvocationKey")
        OR (a."kind" = 'run' AND a."value" = g."runId")) THEN
    RAISE EXCEPTION 'hosted_historical_scope_denied';
  END IF;
  -- This checkpoint fences the hosted v1 provider family. Preserve the
  -- unrelated v4 turn path while still rejecting reused imported aliases.
  IF g."authorityKind" <> 'v1_comment' THEN RETURN true; END IF;
  IF g."historicalGithubRepositoryId" IS NULL OR g."historicalPullRequestNumber" IS NULL
     OR g."historicalHeadSha" IS NULL THEN
    RAISE EXCEPTION 'hosted_historical_trusted_scope_missing';
  END IF;
  IF EXISTS (SELECT 1 FROM public."HostedHistoricalUnknownScope" s
    WHERE s."githubRepositoryId" = g."historicalGithubRepositoryId"
      AND s."pullRequestNumber" = g."historicalPullRequestNumber"
      AND s."headSha" = g."historicalHeadSha"
      AND s."providerFamily" = 'codex_subscription_oauth_hosted_pool') THEN
    RAISE EXCEPTION 'hosted_historical_scope_denied';
  END IF;
  RETURN true;
END $$;

-- Application transactions need a held gate lock, but their read-only gate
-- privilege cannot acquire FOR SHARE. Keep the lock in the caller's transaction
-- and expose only the two authority fields through the canonical owner.
CREATE FUNCTION public.hosted_historical_lock_runtime_gate()
RETURNS TABLE("status" text, "authzEpoch" bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RETURN QUERY SELECT gate."status"::text, gate."authzEpoch"
    FROM public."HostedCodexRuntimeGate" gate
    WHERE gate."id" = 'global' FOR SHARE;
END $$;
DO $historical_owner_handoff$
DECLARE temporary_create boolean := false;
BEGIN
  IF NOT pg_catalog.has_schema_privilege(
    'reviewrouter_release_schema_owner', 'public', 'CREATE') THEN
    GRANT CREATE ON SCHEMA public TO reviewrouter_release_schema_owner;
    temporary_create := true;
  END IF;
  ALTER FUNCTION public.hosted_historical_lock_runtime_gate()
    OWNER TO reviewrouter_release_schema_owner;
  IF temporary_create THEN
    REVOKE CREATE ON SCHEMA public FROM reviewrouter_release_schema_owner;
  END IF;
END $historical_owner_handoff$;

-- Raw 000110 plus administrative ACL convergence must work without relying on
-- a later whole-catalog ownership handoff. These grants are to the non-login
-- canonical owner, not to any application role.
GRANT SELECT, UPDATE ON public."HostedCodexRuntimeGate",
  public."ReviewRequestedIntent", public."RepositoryConnection"
  TO reviewrouter_release_schema_owner;
GRANT SELECT ON public."HostedHistoricalScopePolicy",
  public."HostedHistoricalUnknownScope", public."HostedHistoricalScopeAlias",
  public."HostedHistoricalScopeComplete" TO reviewrouter_release_schema_owner;
GRANT EXECUTE ON FUNCTION public.hosted_historical_set_digest(),
  public.hosted_historical_assert_ready(),
  public.hosted_historical_assert_grant(public."HostedCodexInvocationGrant")
  TO reviewrouter_release_schema_owner;

CREATE FUNCTION public.hosted_historical_grant_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE scope record; gate record;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."historicalGithubRepositoryId" IS DISTINCT FROM OLD."historicalGithubRepositoryId"
       OR NEW."historicalPullRequestNumber" IS DISTINCT FROM OLD."historicalPullRequestNumber"
       OR NEW."historicalHeadSha" IS DISTINCT FROM OLD."historicalHeadSha" THEN
      RAISE EXCEPTION 'hosted_historical_grant_scope_immutable';
    END IF;
    RETURN NEW;
  END IF;
  SELECT "status", "authzEpoch" INTO gate FROM public."HostedCodexRuntimeGate"
    WHERE "id" = 'global' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'hosted_historical_runtime_gate_missing'; END IF;
  IF gate."status" <> 'active' OR gate."authzEpoch" IS DISTINCT FROM NEW."runtimeAuthzEpoch" THEN
    RAISE EXCEPTION 'hosted_historical_runtime_gate_mismatch';
  END IF;
  IF EXISTS (SELECT 1 FROM public."HostedHistoricalScopePolicy" WHERE "id" = 'global')
     AND NEW."authorityKind" = 'v1_comment' THEN
    SELECT r."githubRepositoryId" AS repo, i."pullRequestNumber" AS pr, i."headSha" AS head
    INTO scope FROM public."ReviewRequestedIntent" i
    JOIN public."RepositoryConnection" r ON r."id" = i."repositoryConnectionId"
    WHERE i."requestId" = NEW."reviewRequestId" AND i."workspaceId" = NEW."workspaceId"
      AND i."repositoryConnectionId" = NEW."repositoryConnectionId"
      AND i."scmRepositoryIdentityId" = r."scmRepositoryIdentityId"
      AND i."admissionState" = 'admitted' AND r."provider" = 'github'
      AND r."githubRepositoryId" > 0 AND i."pullRequestNumber" > 0
      AND i."headSha" ~ '^[a-f0-9]{40}$'
    FOR SHARE OF i, r;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'hosted_historical_trusted_scope_missing';
    END IF;
    IF scope.repo IS NULL THEN
      RAISE EXCEPTION 'hosted_historical_trusted_scope_missing';
    END IF;
    NEW."historicalGithubRepositoryId" := scope.repo;
    NEW."historicalPullRequestNumber" := scope.pr;
    NEW."historicalHeadSha" := scope.head;
  ELSE
    -- Legacy-generation callers cannot manufacture a future trusted snapshot.
    NEW."historicalGithubRepositoryId" := NULL;
    NEW."historicalPullRequestNumber" := NULL;
    NEW."historicalHeadSha" := NULL;
  END IF;
  PERFORM public.hosted_historical_assert_grant(NEW);
  RETURN NEW;
END $$;
DO $historical_owner_handoff$
DECLARE temporary_create boolean := false;
BEGIN
  IF NOT pg_catalog.has_schema_privilege(
    'reviewrouter_release_schema_owner', 'public', 'CREATE') THEN
    GRANT CREATE ON SCHEMA public TO reviewrouter_release_schema_owner;
    temporary_create := true;
  END IF;
  ALTER FUNCTION public.hosted_historical_grant_guard()
    OWNER TO reviewrouter_release_schema_owner;
  IF temporary_create THEN
    REVOKE CREATE ON SCHEMA public FROM reviewrouter_release_schema_owner;
  END IF;
END $historical_owner_handoff$;
CREATE TRIGGER hosted_historical_grant_insert BEFORE INSERT OR UPDATE ON public."HostedCodexInvocationGrant"
  FOR EACH ROW EXECUTE FUNCTION public.hosted_historical_grant_guard();

CREATE FUNCTION public.hosted_historical_request_alias_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE grant_row public."HostedCodexInvocationGrant"%ROWTYPE;
BEGIN
  IF EXISTS (SELECT 1 FROM public."HostedHistoricalScopePolicy" WHERE "id" = 'global') THEN
    SELECT * INTO grant_row FROM public."HostedCodexInvocationGrant" WHERE "id" = NEW."grantId";
    IF NOT FOUND THEN RAISE EXCEPTION 'hosted_historical_grant_missing'; END IF;
    PERFORM public.hosted_historical_assert_grant(grant_row);
    IF EXISTS (SELECT 1 FROM public."HostedHistoricalScopeAlias"
      WHERE "kind" = 'relay_request' AND "value" = NEW."id") THEN
      RAISE EXCEPTION 'hosted_historical_request_alias_denied';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER hosted_historical_request_insert BEFORE INSERT ON public."HostedCodexRelayRequest"
  FOR EACH ROW EXECUTE FUNCTION public.hosted_historical_request_alias_guard();

CREATE FUNCTION public.hosted_historical_attempt_alias_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE grant_row public."HostedCodexInvocationGrant"%ROWTYPE;
BEGIN
  IF EXISTS (SELECT 1 FROM public."HostedHistoricalScopePolicy" WHERE "id" = 'global') THEN
    SELECT * INTO grant_row FROM public."HostedCodexInvocationGrant" WHERE "id" = NEW."grantId";
    IF NOT FOUND THEN RAISE EXCEPTION 'hosted_historical_grant_missing'; END IF;
    PERFORM public.hosted_historical_assert_grant(grant_row);
    IF EXISTS (SELECT 1 FROM public."HostedHistoricalScopeAlias"
      WHERE "kind" = 'attempt' AND "value" = NEW."id") THEN
      RAISE EXCEPTION 'hosted_historical_attempt_alias_denied';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER hosted_historical_attempt_insert BEFORE INSERT ON public."HostedCodexUpstreamEffectAttempt"
  FOR EACH ROW EXECUTE FUNCTION public.hosted_historical_attempt_alias_guard();

CREATE FUNCTION public.hosted_historical_refresh_alias_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE grant_row public."HostedCodexInvocationGrant"%ROWTYPE;
BEGIN
  IF EXISTS (SELECT 1 FROM public."HostedHistoricalScopePolicy" WHERE "id" = 'global') THEN
    SELECT * INTO grant_row FROM public."HostedCodexInvocationGrant" WHERE "id" = NEW."grantId";
    IF NOT FOUND THEN RAISE EXCEPTION 'hosted_historical_grant_missing'; END IF;
    PERFORM public.hosted_historical_assert_grant(grant_row);
    IF EXISTS (SELECT 1 FROM public."HostedHistoricalScopeAlias"
      WHERE "kind" = 'refresh_capability' AND "value" = NEW."capabilityTokenHash") THEN
      RAISE EXCEPTION 'hosted_historical_refresh_alias_denied';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER hosted_historical_refresh_insert BEFORE INSERT ON public."HostedCodexCommentRefreshCapability"
  FOR EACH ROW EXECUTE FUNCTION public.hosted_historical_refresh_alias_guard();

CREATE FUNCTION public.hosted_historical_gate_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW."status" = 'active' THEN
    -- A stale snapshot can otherwise take the absent-policy fast path after a
    -- concurrent importer commits a policy without changing the gate tuple.
    IF current_setting('transaction_isolation') <> 'read committed' THEN
      RAISE EXCEPTION 'hosted_historical_activation_requires_read_committed';
    END IF;
    PERFORM public.hosted_historical_assert_ready();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER hosted_historical_gate_open BEFORE INSERT OR UPDATE ON public."HostedCodexRuntimeGate"
  FOR EACH ROW EXECUTE FUNCTION public.hosted_historical_gate_guard();

REVOKE ALL ON FUNCTION public.hosted_historical_set_digest() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hosted_historical_setup_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hosted_historical_assert_ready() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hosted_historical_assert_grant(public."HostedCodexInvocationGrant") FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hosted_historical_lock_runtime_gate() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hosted_historical_grant_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hosted_historical_request_alias_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hosted_historical_attempt_alias_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hosted_historical_refresh_alias_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hosted_historical_gate_guard() FROM PUBLIC;

-- These named runtime roles may read the projection but cannot alter it.
DO $$ DECLARE role_name text; table_name text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['reviewrouter_api','reviewrouter_web','reviewrouter_worker','reviewrouter_comment_token_custody'] LOOP
    IF pg_catalog.to_regrole(role_name) IS NOT NULL THEN
      FOREACH table_name IN ARRAY ARRAY['HostedHistoricalScopePolicy','HostedHistoricalUnknownScope',
        'HostedHistoricalScopeAlias','HostedHistoricalScopeComplete'] LOOP
        EXECUTE pg_catalog.format('GRANT SELECT ON TABLE public.%I TO %I', table_name, role_name);
        EXECUTE pg_catalog.format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.%I FROM %I', table_name, role_name);
      END LOOP;
      EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION public.hosted_historical_set_digest() TO %I', role_name);
      EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION public.hosted_historical_assert_ready() TO %I', role_name);
      EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION public.hosted_historical_assert_grant(public."HostedCodexInvocationGrant") TO %I', role_name);
      IF role_name = 'reviewrouter_api' THEN
        EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION public.hosted_historical_lock_runtime_gate() TO %I', role_name);
      END IF;
    END IF;
  END LOOP;
END $$;
COMMIT;
