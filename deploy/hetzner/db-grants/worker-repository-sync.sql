\set ON_ERROR_STOP on
-- The worker runs installation.sync_requested, which upserts RepositoryConnection.
-- The canonical runtime ACL applied after every release migration
-- (scripts/run-codex-rotating-release-migration.mjs) revokes INSERT and UPDATE on
-- that table from the api, web and worker roles, so repository sync dead-letters
-- with "permission denied for table RepositoryConnection" after each release.
-- Apply this after the ACL step of every release, as the database owner.
-- The referential guard trigger from migration 000133 still blocks changes to
-- parent-FK columns. Idempotent.
BEGIN;
SET LOCAL ROLE reviewrouter;
DO $$
BEGIN
  IF current_database() <> 'review_router_dimy' THEN
    RAISE EXCEPTION 'unexpected database %', current_database();
  END IF;
END
$$;
GRANT INSERT, UPDATE ON TABLE public."RepositoryConnection" TO reviewrouter_worker;
GRANT USAGE ON SEQUENCE public."RepositoryInventoryGeneration" TO reviewrouter_worker;
DO $$
BEGIN
  IF NOT has_table_privilege('reviewrouter_worker', 'public."RepositoryConnection"', 'INSERT')
     OR NOT has_table_privilege('reviewrouter_worker', 'public."RepositoryConnection"', 'UPDATE')
     OR NOT has_sequence_privilege('reviewrouter_worker', 'public."RepositoryInventoryGeneration"', 'USAGE') THEN
    RAISE EXCEPTION 'worker repository sync grant verification failed';
  END IF;
END
$$;
COMMIT;
