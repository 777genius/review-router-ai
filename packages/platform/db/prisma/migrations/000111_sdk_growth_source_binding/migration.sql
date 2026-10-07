-- Existing NULL rows retain the exact historical v1 identity and digest.
ALTER TABLE "SdkGrowthAuthorityCustody"
  ADD COLUMN "sourceBinding" JSONB
  CONSTRAINT "SdkGrowthAuthorityCustody_source_binding_shape"
  CHECK ("sourceBinding" IS NULL OR
    (jsonb_typeof("sourceBinding") = 'object' AND octet_length("sourceBinding"::text) BETWEEN 2 AND 2048));
ALTER TABLE "SdkGrowthVerifierEvidence"
  ADD COLUMN "sourceBinding" JSONB
  CONSTRAINT "SdkGrowthVerifierEvidence_source_binding_shape"
  CHECK ("sourceBinding" IS NULL OR
    (jsonb_typeof("sourceBinding") = 'object' AND octet_length("sourceBinding"::text) BETWEEN 2 AND 2048));
ALTER TABLE "SdkGrowthFinalizedReportEvidence"
  ADD COLUMN "sourceBinding" JSONB
  CONSTRAINT "SdkGrowthFinalizedReportEvidence_source_binding_shape"
  CHECK ("sourceBinding" IS NULL OR
    (jsonb_typeof("sourceBinding") = 'object' AND octet_length("sourceBinding"::text) BETWEEN 2 AND 2048));

-- 000103's admission preservation trigger predates this column. Keep the
-- existing completion-only update path, but never allow rebinding its source.
CREATE FUNCTION sdk_growth_custody_source_binding_preserve() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW."sourceBinding" IS DISTINCT FROM OLD."sourceBinding" THEN
    RAISE EXCEPTION 'SDK growth source binding is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sdk_growth_custody_source_binding_immutable
  BEFORE UPDATE ON "SdkGrowthAuthorityCustody"
  FOR EACH ROW EXECUTE FUNCTION sdk_growth_custody_source_binding_preserve();
