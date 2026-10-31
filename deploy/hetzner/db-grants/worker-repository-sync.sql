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
-- gitlabInstallationId, scmRepositoryIdentityId, setupStatus or the lifecycle
-- columns, and cannot INSERT scmRepositoryIdentityId or gitlabInstallationId.
-- Not covered: the referential guard trigger fires on UPDATE of parent-FK
-- columns and on DELETE, not on INSERT, so an INSERT can still choose
-- workspaceId and installationId. See the tracking issue for the stronger option.
-- Idempotent.
BEGIN;
SET LOCAL ROLE reviewrouter;
DO $$
BEGIN
  IF current_database() <> 'review_router_dimy' THEN
    RAISE EXCEPTION 'unexpected database %', current_database();
  END IF;
END
$$;
REVOKE INSERT, UPDATE ON TABLE public."RepositoryConnection" FROM reviewrouter_worker;
GRANT INSERT ("id","workspaceId","provider","sourceBaseUrl","externalRepositoryId","installationId","githubRepositoryId","owner","name","fullName","defaultBranch","visibility","selected","archived","stargazersCount","setupStatus","inventoryGeneration","lifecycleResolutionMode","lifecycleResolutionActivationVersion","lastSyncedAt","createdAt","updatedAt")
  ON TABLE public."RepositoryConnection" TO reviewrouter_worker;
GRANT UPDATE ("workspaceId","provider","sourceBaseUrl","externalRepositoryId","installationId","owner","name","fullName","defaultBranch","visibility","archived","stargazersCount","selected","lastSyncedAt","inventoryGeneration","updatedAt")
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
     OR has_column_privilege('reviewrouter_worker', 'public."RepositoryConnection"', 'scmRepositoryIdentityId', 'UPDATE')
     OR has_column_privilege('reviewrouter_worker', 'public."RepositoryConnection"', 'scmRepositoryIdentityId', 'INSERT')
     OR has_column_privilege('reviewrouter_worker', 'public."RepositoryConnection"', 'id', 'UPDATE')
     OR NOT has_sequence_privilege('reviewrouter_worker', 'public."RepositoryInventoryGeneration"', 'USAGE') THEN
    RAISE EXCEPTION 'worker repository sync grant verification failed';
  END IF;
END
$$;
COMMIT;
