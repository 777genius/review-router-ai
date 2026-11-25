-- Dormant G1 credential custody. Provisioning and use require a later,
-- transaction-fenced administrative path; no credential is created here.
CREATE TABLE "SdkGrowthOperatorCredential" (
  "credentialId" VARCHAR(64) PRIMARY KEY,
  "generation" BIGINT NOT NULL,
  "verifierSha256" VARCHAR(64) NOT NULL,
  "disabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "expiresAtMs" BIGINT NOT NULL,
  "tenantId" VARCHAR(256) NOT NULL,
  "repositoryId" VARCHAR(256) NOT NULL,
  "pullRequest" BIGINT NOT NULL,
  "githubRepositoryId" VARCHAR(256) NOT NULL,
  "installationId" VARCHAR(256) NOT NULL,
  "issuer" VARCHAR(256) NOT NULL,
  "subject" VARCHAR(256) NOT NULL,
  "allowedOperations" TEXT[] NOT NULL,
  CONSTRAINT "SdkGrowthOperatorCredential_id_check"
    CHECK ("credentialId" ~ '^[A-Za-z0-9_-]{16,64}$'),
  CONSTRAINT "SdkGrowthOperatorCredential_generation_check"
    CHECK ("generation" > 0),
  CONSTRAINT "SdkGrowthOperatorCredential_expiry_check"
    CHECK ("expiresAtMs" > 0),
  CONSTRAINT "SdkGrowthOperatorCredential_verifier_check"
    CHECK ("verifierSha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "SdkGrowthOperatorCredential_scope_check"
    CHECK ("pullRequest" > 0 AND "tenantId" <> '' AND "repositoryId" <> ''
      AND "githubRepositoryId" <> '' AND "installationId" <> ''
      AND "issuer" <> '' AND "subject" <> ''),
  CONSTRAINT "SdkGrowthOperatorCredential_operations_check"
    CHECK (cardinality("allowedOperations") BETWEEN 1 AND 6
      AND array_position("allowedOperations", NULL) IS NULL
      AND "allowedOperations" <@ ARRAY[
        'provision', 'binding-replacement', 'owner-replacement',
        'owner-revocation', 'installation-invalidation', 'verifier-withdrawal'
      ]::TEXT[])
);

CREATE INDEX "SdkGrowthOperatorCredential_scope_idx"
  ON "SdkGrowthOperatorCredential" ("tenantId", "repositoryId", "pullRequest");

CREATE FUNCTION sdk_growth_operator_credential_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'G1 operator credential cannot be deleted';
  END IF;
  IF ROW(NEW."credentialId", NEW."tenantId", NEW."repositoryId",
         NEW."pullRequest", NEW."githubRepositoryId", NEW."installationId",
         NEW."issuer", NEW."subject") IS DISTINCT FROM
     ROW(OLD."credentialId", OLD."tenantId", OLD."repositoryId",
         OLD."pullRequest", OLD."githubRepositoryId", OLD."installationId",
         OLD."issuer", OLD."subject") THEN
    RAISE EXCEPTION 'G1 operator credential identity is immutable';
  END IF;
  IF ROW(NEW."verifierSha256", NEW."disabled", NEW."expiresAtMs", NEW."allowedOperations") IS DISTINCT FROM
     ROW(OLD."verifierSha256", OLD."disabled", OLD."expiresAtMs", OLD."allowedOperations")
     AND NEW."generation" <= OLD."generation" THEN
    RAISE EXCEPTION 'G1 operator credential policy change requires generation advance';
  END IF;
  IF NEW."generation" < OLD."generation" THEN
    RAISE EXCEPTION 'G1 operator credential generation cannot decrease';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "SdkGrowthOperatorCredential_guard"
  BEFORE UPDATE OR DELETE ON "SdkGrowthOperatorCredential"
  FOR EACH ROW EXECUTE FUNCTION sdk_growth_operator_credential_guard();

CREATE FUNCTION sdk_growth_operator_credential_no_truncate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'G1 operator credentials cannot be truncated';
END;
$$;
CREATE TRIGGER "SdkGrowthOperatorCredential_no_truncate"
  BEFORE TRUNCATE ON "SdkGrowthOperatorCredential"
  FOR EACH STATEMENT EXECUTE FUNCTION sdk_growth_operator_credential_no_truncate();
