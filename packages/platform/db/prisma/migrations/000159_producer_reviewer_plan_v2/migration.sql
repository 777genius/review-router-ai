-- Plan 67: reviewer plan version 2 adds the ordered fallback. A producer may
-- now declare plan version 1 or 2; every other rule of the 000152 profile
-- CHECK is unchanged and existing version 1 rows remain valid.
BEGIN;
ALTER TABLE "ProducerRelease" DROP CONSTRAINT "ProducerRelease_reviewer_plan_profile_check";
ALTER TABLE "ProducerRelease" ADD CONSTRAINT "ProducerRelease_reviewer_plan_profile_check" CHECK (
  "reviewerPlanProfile" IS NULL OR (
    jsonb_typeof("reviewerPlanProfile") = 'object' AND
    "reviewerPlanProfile" ?& ARRAY['planVersion', 'descriptorDigest'] AND
    "reviewerPlanProfile" - ARRAY['planVersion', 'descriptorDigest'] = '{}'::jsonb AND
    "reviewerPlanProfile" -> 'planVersion' IN ('1'::jsonb, '2'::jsonb) AND
    "reviewerPlanProfile" ->> 'descriptorDigest' ~ '^sha256:[a-f0-9]{64}$') IS TRUE);
COMMIT;
