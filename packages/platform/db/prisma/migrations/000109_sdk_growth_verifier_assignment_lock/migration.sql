-- A producer with assignment SELECT must not need table UPDATE merely to
-- hold a row lock while its custody transaction commits.
BEGIN;

CREATE FUNCTION public.sdk_growth_verifier_assignment_lock(p_assignment_id text)
RETURNS SETOF public."SdkGrowthVerifierAssignment"
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT assignment.*
  FROM public."SdkGrowthVerifierAssignment" AS assignment
  WHERE assignment."assignmentId" = p_assignment_id
  FOR SHARE OF assignment
$function$;

REVOKE ALL ON FUNCTION public.sdk_growth_verifier_assignment_lock(text) FROM PUBLIC;
-- Grant EXECUTE only to the isolated verifier producer role during deployment.

-- Read the current epoch and immutable facts while holding the current row
-- through the caller's custody transaction. The producer needs SELECT on the
-- authority tables, but only this table owner may acquire FOR SHARE.
CREATE FUNCTION public.sdk_growth_verifier_current_authority_lock(p_scope_key text)
RETURNS TABLE (
  "epoch" bigint,
  "binding" jsonb,
  "evidence" jsonb,
  "provenance" jsonb,
  "installationActive" boolean,
  "verifierActive" boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT c."epoch", b."binding", o."evidence", o."provenance", o."installationActive", o."verifierActive"
  FROM public."SdkGrowthCurrentAuthority" AS c
  JOIN public."SdkGrowthBindingVersion" AS b ON b."scopeKey" = c."scopeKey" AND b."epoch" = c."epoch"
  JOIN public."SdkGrowthOwnerVersion" AS o ON o."scopeKey" = c."scopeKey" AND o."epoch" = c."epoch"
  WHERE c."scopeKey" = p_scope_key
  FOR SHARE OF c
$function$;

REVOKE ALL ON FUNCTION public.sdk_growth_verifier_current_authority_lock(text) FROM PUBLIC;
-- Grant EXECUTE only to the isolated verifier producer role during deployment.

COMMIT;
