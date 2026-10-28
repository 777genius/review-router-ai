-- Checkout must hold the repository row through its authority confirmation.
-- Runtime principals deliberately have SELECT only on RepositoryConnection;
-- keep FOR SHARE in the existing canonical NOLOGIN owner's narrow helper.
BEGIN;

CREATE FUNCTION public.rr_review_run_checkout_repository_lock(
  p_workspace_id text,
  p_repository_connection_id text
)
RETURNS TABLE(id text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT repository."id"
  FROM public."RepositoryConnection" AS repository
  WHERE repository."workspaceId" = p_workspace_id
    AND repository."id" = p_repository_connection_id
  FOR SHARE OF repository
$function$;

DO $checkout_repository_owner_handoff$
DECLARE temporary_create boolean := false;
BEGIN
  IF NOT pg_catalog.has_schema_privilege(
    'reviewrouter_release_schema_owner', 'public', 'CREATE') THEN
    GRANT CREATE ON SCHEMA public TO reviewrouter_release_schema_owner;
    temporary_create := true;
  END IF;
  ALTER FUNCTION public.rr_review_run_checkout_repository_lock(text, text)
    OWNER TO reviewrouter_release_schema_owner;
  IF temporary_create THEN
    REVOKE CREATE ON SCHEMA public FROM reviewrouter_release_schema_owner;
  END IF;
END $checkout_repository_owner_handoff$;

REVOKE ALL ON FUNCTION public.rr_review_run_checkout_repository_lock(text, text)
  FROM PUBLIC;
-- API-only EXECUTE is projected by the canonical runtime ACL convergence.
-- No runtime table or column write privilege is introduced.
COMMIT;
