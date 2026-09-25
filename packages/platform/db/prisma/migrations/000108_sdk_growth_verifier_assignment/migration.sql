-- Server-side protected verifier jobs. A credential is only a short-lived
-- reference to this record; execution never comes from the bearer token.
CREATE TABLE "SdkGrowthVerifierAssignment" (
  "assignmentId" TEXT PRIMARY KEY,
  "jobKey" VARCHAR(64) NOT NULL,
  "execution" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "revokedAt" TIMESTAMPTZ(3),
  CONSTRAINT "SdkGrowthVerifierAssignment_job_key_check" CHECK ("jobKey" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "SdkGrowthVerifierAssignment_expiry_check" CHECK ("expiresAt" > "createdAt"),
  CONSTRAINT "SdkGrowthVerifierAssignment_ttl_check" CHECK ("expiresAt" <= "createdAt" + INTERVAL '24 hours'),
  CONSTRAINT "SdkGrowthVerifierAssignment_execution_object_check" CHECK (jsonb_typeof("execution") = 'object')
);

CREATE INDEX "SdkGrowthVerifierAssignment_expires_idx"
  ON "SdkGrowthVerifierAssignment" ("expiresAt");

CREATE UNIQUE INDEX "SdkGrowthVerifierAssignment_active_job_key"
  ON "SdkGrowthVerifierAssignment" ("jobKey") WHERE "revokedAt" IS NULL;

CREATE FUNCTION sdk_growth_verifier_assignment_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'verifier assignment cannot be deleted';
  END IF;
  IF NEW."assignmentId" IS DISTINCT FROM OLD."assignmentId"
     OR NEW."jobKey" IS DISTINCT FROM OLD."jobKey"
     OR NEW."execution" IS DISTINCT FROM OLD."execution"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
     OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
     OR (OLD."revokedAt" IS NOT NULL AND NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt")
     OR (OLD."revokedAt" IS NULL AND NEW."revokedAt" IS NULL) THEN
    RAISE EXCEPTION 'verifier assignment is immutable except revocation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "SdkGrowthVerifierAssignment_immutable"
  BEFORE UPDATE OR DELETE ON "SdkGrowthVerifierAssignment"
  FOR EACH ROW EXECUTE FUNCTION sdk_growth_verifier_assignment_immutable();

CREATE FUNCTION sdk_growth_verifier_assignment_no_truncate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'verifier assignment cannot be truncated';
END;
$$;

CREATE TRIGGER "SdkGrowthVerifierAssignment_no_truncate"
  BEFORE TRUNCATE ON "SdkGrowthVerifierAssignment"
  FOR EACH STATEMENT EXECUTE FUNCTION sdk_growth_verifier_assignment_no_truncate();
