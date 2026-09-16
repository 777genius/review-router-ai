-- Additive authority storage; no repository FK: authority scope uses trusted external identities.
CREATE TABLE "SdkGrowthAuthorityScope" (
  "tenantId" VARCHAR(256) NOT NULL,
  "repositoryId" VARCHAR(256) NOT NULL,
  "pullRequest" BIGINT NOT NULL CHECK ("pullRequest" BETWEEN 1 AND 9007199254740991),
  "fence" BIGINT NOT NULL DEFAULT 0 CHECK ("fence" BETWEEN 0 AND 9007199254740991),
  PRIMARY KEY ("tenantId", "repositoryId", "pullRequest")
);
CREATE TABLE "SdkGrowthAuthorityRecord" (
  "tenantId" VARCHAR(256) NOT NULL,
  "repositoryId" VARCHAR(256) NOT NULL,
  "pullRequest" BIGINT NOT NULL,
  "fence" BIGINT NOT NULL CHECK ("fence" BETWEEN 1 AND 9007199254740991),
  "requestId" VARCHAR(256) NOT NULL,
  "metadata" JSONB NOT NULL CHECK (
    jsonb_typeof("metadata") = 'object' AND
    octet_length("metadata"::text) <= 2097152 AND
    "metadata" ?& ARRAY['grant', 'revoked', 'completion', 'receipt', 'intent', 'dispatched'] AND
    "metadata" - ARRAY['grant', 'revoked', 'completion', 'receipt', 'intent', 'dispatched'] = '{}'::jsonb
  ),
  PRIMARY KEY ("tenantId", "repositoryId", "pullRequest", "fence"),
  FOREIGN KEY ("tenantId", "repositoryId", "pullRequest")
    REFERENCES "SdkGrowthAuthorityScope" ("tenantId", "repositoryId", "pullRequest") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "SdkGrowthAuthorityRecord_request_key"
  ON "SdkGrowthAuthorityRecord" ("tenantId", "repositoryId", "pullRequest", "requestId");

-- Defense in depth against accidental cleanup/reset by other writers.
CREATE FUNCTION sdk_growth_authority_preserve() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'SDK authority tombstones cannot be deleted';
  END IF;
  IF (NEW."tenantId", NEW."repositoryId", NEW."pullRequest") IS DISTINCT FROM
     (OLD."tenantId", OLD."repositoryId", OLD."pullRequest") THEN
    RAISE EXCEPTION 'SDK authority scope is immutable';
  END IF;
  IF TG_TABLE_NAME = 'SdkGrowthAuthorityScope' THEN
    IF NEW."fence" < OLD."fence" THEN
      RAISE EXCEPTION 'SDK authority fence cannot decrease';
    END IF;
  ELSE
    IF NEW."fence" <> OLD."fence" OR NEW."requestId" <> OLD."requestId" OR
       NEW."metadata"->'grant' IS DISTINCT FROM OLD."metadata"->'grant' OR
       (OLD."metadata"->'revoked' = 'true'::jsonb AND NEW."metadata"->'revoked' IS DISTINCT FROM 'true'::jsonb) OR
       (OLD."metadata"->'dispatched' = 'true'::jsonb AND NEW."metadata"->'dispatched' IS DISTINCT FROM 'true'::jsonb) OR
       (OLD."metadata"->'completion' <> 'null'::jsonb AND
         (NEW."metadata"->'completion' IS DISTINCT FROM OLD."metadata"->'completion' OR
          NEW."metadata"->'receipt' IS DISTINCT FROM OLD."metadata"->'receipt' OR
          NEW."metadata"->'intent' IS DISTINCT FROM OLD."metadata"->'intent')) THEN
      RAISE EXCEPTION 'SDK authority tombstone is immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sdk_growth_scope_preserve BEFORE UPDATE OR DELETE ON "SdkGrowthAuthorityScope"
  FOR EACH ROW EXECUTE FUNCTION sdk_growth_authority_preserve();
CREATE TRIGGER sdk_growth_record_preserve BEFORE UPDATE OR DELETE ON "SdkGrowthAuthorityRecord"
  FOR EACH ROW EXECUTE FUNCTION sdk_growth_authority_preserve();
CREATE TRIGGER sdk_growth_scope_no_truncate BEFORE TRUNCATE ON "SdkGrowthAuthorityScope"
  FOR EACH STATEMENT EXECUTE FUNCTION sdk_growth_authority_preserve();
CREATE TRIGGER sdk_growth_record_no_truncate BEFORE TRUNCATE ON "SdkGrowthAuthorityRecord"
  FOR EACH STATEMENT EXECUTE FUNCTION sdk_growth_authority_preserve();
