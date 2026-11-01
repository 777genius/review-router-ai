\set ON_ERROR_STOP on
-- The worker runs installation.sync_requested, which upserts RepositoryConnection.
-- The canonical runtime ACL applied after every release migration
-- (scripts/run-codex-rotating-release-migration.mjs) makes that table read-only
-- for api, web and worker, so repository sync dead-letters with
-- "permission denied for table RepositoryConnection" after each release.
-- Apply this after the ACL step of every release, as the database owner.
--
-- Least privilege: column-level grants for exactly the columns the sync writes
-- (taken from the SQL Prisma generates for the repository adapter). The worker
-- gets no table-level INSERT/UPDATE/DELETE, cannot UPDATE id, githubRepositoryId,
-- gitlabInstallationId, setupStatus or the lifecycle
-- columns, and cannot INSERT scmRepositoryIdentityId or gitlabInstallationId.
-- UPDATE scmRepositoryIdentityId is permitted only behind the already installed
-- migration 000133 guard: a first binding to the identity that already declares
-- the same connection/workspace. Retargeting and clearing stay forbidden.
-- Not covered: the referential guard trigger fires on UPDATE of parent-FK
-- columns and on DELETE, not on INSERT, so an INSERT can still choose
-- workspaceId and installationId. See the tracking issue for the stronger option.
-- Idempotent.
BEGIN;
SET LOCAL search_path = pg_catalog, public;
SET LOCAL lock_timeout = '5000ms';
SET LOCAL statement_timeout = '120000ms';
-- Share the canonical ACL/activation runner's existing exclusion fence.
SELECT pg_catalog.pg_advisory_xact_lock(1381126735, 1129271120);
SET LOCAL ROLE reviewrouter;
DO $$
BEGIN
  IF current_database() <> 'review_router_dimy' THEN
    RAISE EXCEPTION 'unexpected database %', current_database();
  END IF;
  -- This grant does not replace a routine or change activation trust roots.
  -- Require the qualified 000133 guard and its complete active trigger.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger trigger_record
    JOIN pg_catalog.pg_proc guard ON guard.oid = trigger_record.tgfoid
    WHERE trigger_record.tgrelid = 'public."RepositoryConnection"'::regclass
      AND trigger_record.tgname = 'RepositoryConnection_runtime_referential_action_guard'
      AND NOT trigger_record.tgisinternal
      AND trigger_record.tgenabled IN ('O', 'A')
      AND trigger_record.tgtype = 27 -- BEFORE ROW UPDATE OR DELETE
      AND trigger_record.tgqual IS NULL
      AND trigger_record.tgnargs = 0
      AND (
        SELECT array_agg(attribute.attname::text ORDER BY attribute.attname)
        FROM pg_catalog.pg_attribute attribute
        WHERE attribute.attrelid = trigger_record.tgrelid
          AND attribute.attnum = ANY(trigger_record.tgattr)
      ) = ARRAY['gitlabInstallationId','id','installationId','scmRepositoryIdentityId','workspaceId']
      AND guard.oid = 'public.codex_oauth_runtime_referential_action_guard()'::regprocedure
      AND guard.proowner = 'reviewrouter'::regrole
      AND guard.prosecdef
      AND guard.proconfig = ARRAY['search_path=pg_catalog, public']
      AND guard.prolang = (SELECT oid FROM pg_catalog.pg_language WHERE lanname = 'plpgsql')
      AND encode(sha256(convert_to(guard.prosrc, 'UTF8')), 'hex') =
          '2dba7b0fe03733cbe66ae6f61331e449ac679c866af6a0d1d43fc81acbd72771'
  ) THEN
    RAISE EXCEPTION 'qualified worker first-bind guard is required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'reviewrouter_worker' AND rolcanlogin
      AND NOT rolsuper AND NOT rolbypassrls
  ) THEN
    RAISE EXCEPTION 'worker must remain an unprivileged login role';
  END IF;
END
$$;
REVOKE INSERT, UPDATE ON TABLE public."RepositoryConnection" FROM reviewrouter_worker;
GRANT INSERT ("id","workspaceId","provider","sourceBaseUrl","externalRepositoryId","installationId","githubRepositoryId","owner","name","fullName","defaultBranch","visibility","selected","archived","stargazersCount","setupStatus","inventoryGeneration","lifecycleResolutionMode","lifecycleResolutionActivationVersion","lastSyncedAt","createdAt","updatedAt")
  ON TABLE public."RepositoryConnection" TO reviewrouter_worker;
GRANT UPDATE ("workspaceId","provider","sourceBaseUrl","externalRepositoryId","installationId","owner","name","fullName","defaultBranch","visibility","archived","stargazersCount","selected","lastSyncedAt","inventoryGeneration","updatedAt","scmRepositoryIdentityId")
  ON TABLE public."RepositoryConnection" TO reviewrouter_worker;
GRANT USAGE ON SEQUENCE public."RepositoryInventoryGeneration" TO reviewrouter_worker;
DO $$
BEGIN
  IF has_table_privilege('reviewrouter_worker', 'public."RepositoryConnection"', 'INSERT')
     OR has_table_privilege('reviewrouter_worker', 'public."RepositoryConnection"', 'UPDATE')
     OR has_table_privilege('reviewrouter_worker', 'public."RepositoryConnection"', 'DELETE') THEN
    RAISE EXCEPTION 'table-level write privilege must be absent';
  END IF;
  IF NOT has_column_privilege('reviewrouter_worker', 'public."RepositoryConnection"', 'fullName', 'UPDATE')
     OR NOT has_column_privilege('reviewrouter_worker', 'public."RepositoryConnection"', 'githubRepositoryId', 'INSERT')
     OR NOT has_column_privilege('reviewrouter_worker', 'public."RepositoryConnection"', 'scmRepositoryIdentityId', 'UPDATE')
     OR has_column_privilege('reviewrouter_worker', 'public."RepositoryConnection"', 'scmRepositoryIdentityId', 'INSERT')
     OR has_column_privilege('reviewrouter_worker', 'public."RepositoryConnection"', 'id', 'UPDATE')
     OR NOT has_sequence_privilege('reviewrouter_worker', 'public."RepositoryInventoryGeneration"', 'USAGE') THEN
    RAISE EXCEPTION 'worker repository sync grant verification failed';
  END IF;
END
$$;
COMMIT;
