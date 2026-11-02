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

-- Install a separate tenant/installation INSERT fence before granting worker
-- INSERT. The canonical 000133 referential action trigger covers only UPDATE
-- and DELETE, so neither that guard nor independent FKs prevent a cross-tenant
-- insertion. Keep this transaction under the existing activation exclusion.
DO $install_repository_insert_guard$
DECLARE
  newly_created boolean := false;
BEGIN
  IF pg_catalog.to_regprocedure(
    'public.reviewrouter_worker_repository_insert_guard()'
  ) IS NULL THEN
    EXECUTE $create_worker_insert_guard$
CREATE FUNCTION public.reviewrouter_worker_repository_insert_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $worker_insert_body$
DECLARE
  installation_workspace text;
BEGIN
  -- Only the worker LOGIN may create new repository connections. An
  -- administrative owner may continue doing controlled schema/data repair.
  IF session_user IN (
    'reviewrouter_api', 'reviewrouter_web',
    'reviewrouter_codex_effect_authority'
  ) THEN
    RAISE EXCEPTION 'worker_repository_insert_runtime_role_forbidden'
      USING ERRCODE = '42501';
  END IF;
  IF session_user <> 'reviewrouter_worker' THEN
    RETURN NEW;
  END IF;
  IF NEW."provider"::text IS DISTINCT FROM 'github'
     OR NEW."sourceBaseUrl" IS DISTINCT FROM 'https://github.com'
     OR NEW."installationId" IS NULL
     OR NEW."gitlabInstallationId" IS NOT NULL
     OR NEW."scmRepositoryIdentityId" IS NOT NULL
     OR NEW."githubRepositoryId" IS NULL
     OR NEW."githubRepositoryId" <= 0
     OR NEW."externalRepositoryId" IS DISTINCT FROM
        NEW."githubRepositoryId"::text
  THEN
    RAISE EXCEPTION 'worker_repository_insert_identity_forbidden'
      USING ERRCODE = '42501';
  END IF;
  -- The two existing foreign keys check parent existence independently, not
  -- their shared tenant. Lock the installation to serialize a parent move
  -- against the new row until commit.
  SELECT "workspaceId" INTO installation_workspace
    FROM public."GitHubInstallation"
    WHERE "id" = NEW."installationId"
    FOR SHARE;
  IF NOT FOUND
     OR installation_workspace IS DISTINCT FROM NEW."workspaceId"
  THEN
    RAISE EXCEPTION 'worker_repository_insert_workspace_forbidden'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$worker_insert_body$;
$create_worker_insert_guard$;
    newly_created := true;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc guard
    WHERE guard.oid =
      'public.reviewrouter_worker_repository_insert_guard()'::regprocedure
      AND guard.proowner = 'reviewrouter'::regrole
      AND guard.prosecdef
      AND guard.proconfig = ARRAY['search_path=pg_catalog, public']
      AND guard.prolang =
        (SELECT oid FROM pg_catalog.pg_language WHERE lanname = 'plpgsql')
      AND pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(guard.prosrc, 'UTF8')),
        'hex'
      ) = 'c3fe6186891abbdf8b990ab70f255ebb762414fc87e09952590f74bad5cb4669'
  ) THEN
    RAISE EXCEPTION 'worker repository insert function integrity failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger trigger_record
    WHERE trigger_record.tgrelid =
      'public."RepositoryConnection"'::regclass
      AND trigger_record.tgname =
        'RepositoryConnection_worker_insert_scope_guard'
  ) THEN
    IF NOT newly_created THEN
      RAISE EXCEPTION 'worker repository insert trigger missing';
    END IF;
    EXECUTE 'CREATE TRIGGER "RepositoryConnection_worker_insert_scope_guard"
      BEFORE INSERT ON public."RepositoryConnection"
      FOR EACH ROW EXECUTE FUNCTION
        public.reviewrouter_worker_repository_insert_guard()';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger trigger_record
    WHERE trigger_record.tgrelid =
      'public."RepositoryConnection"'::regclass
      AND trigger_record.tgname =
        'RepositoryConnection_worker_insert_scope_guard'
      AND NOT trigger_record.tgisinternal
      AND trigger_record.tgenabled IN ('O', 'A')
      AND trigger_record.tgtype = 7 -- BEFORE INSERT FOR EACH ROW
      AND trigger_record.tgqual IS NULL
      AND trigger_record.tgnargs = 0
      AND trigger_record.tgfoid =
        'public.reviewrouter_worker_repository_insert_guard()'::regprocedure
  ) THEN
    RAISE EXCEPTION 'qualified worker repository insert trigger is required';
  END IF;
END
$install_repository_insert_guard$;
REVOKE ALL ON FUNCTION
  public.reviewrouter_worker_repository_insert_guard()
  FROM PUBLIC, reviewrouter_worker;
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
