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

COMMIT;
