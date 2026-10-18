-- The rotating-cascade guard added by 000066 forbids the LOGIN-backed app roles
-- from touching any RepositoryConnection parent-FK column, including
-- "scmRepositoryIdentityId". That also blocks the sanctioned repair path:
-- installation inventory synchronization binds an unbound repository connection
-- to its SCM identity, so every first-time bind dead-lettered as
-- codex_oauth_runtime_referential_update_forbidden and the repository could
-- never reach Gateway review readiness.
--
-- Keep the guard's purpose - an app role may not re-parent a repository row or
-- silently retarget an identity that is already bound - and allow only the
-- unbound-to-bound transition. Re-binding and un-binding an existing identity
-- stay forbidden, as does deleting the referenced identity.
CREATE OR REPLACE FUNCTION "codex_oauth_runtime_referential_action_guard"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF session_user IN (
    'reviewrouter_api',
    'reviewrouter_web',
    'reviewrouter_worker',
    'reviewrouter_codex_effect_authority'
  ) THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'codex_oauth_runtime_referential_delete_forbidden'
        USING ERRCODE = '42501';
    END IF;

    -- These are precisely the RepositoryConnection columns changed by the
    -- Workspace/installation/SCM-identity parent FKs. The other
    -- repository identity columns remain repairable by the sanctioned routine.
    IF NEW."id" IS DISTINCT FROM OLD."id"
       OR NEW."workspaceId" IS DISTINCT FROM OLD."workspaceId"
       OR NEW."installationId" IS DISTINCT FROM OLD."installationId"
       OR NEW."gitlabInstallationId" IS DISTINCT FROM OLD."gitlabInstallationId"
       OR (
         OLD."scmRepositoryIdentityId" IS NOT NULL
         AND NEW."scmRepositoryIdentityId" IS DISTINCT FROM OLD."scmRepositoryIdentityId"
       )
    THEN
      RAISE EXCEPTION 'codex_oauth_runtime_referential_update_forbidden'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
