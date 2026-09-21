-- Separate bounded immutable custody; the compact authority ledger remains unchanged.
CREATE TABLE "SdkGrowthAuthorityCustody" (
  "custodyId" TEXT PRIMARY KEY,
  "tenantId" VARCHAR(256) NOT NULL,
  "repositoryId" VARCHAR(256) NOT NULL,
  "pullRequest" BIGINT NOT NULL CHECK ("pullRequest" BETWEEN 1 AND 9007199254740991),
  "githubRepositoryId" VARCHAR(256) NOT NULL,
  "installationId" VARCHAR(256) NOT NULL,
  "subject" VARCHAR(256) NOT NULL,
  "runId" VARCHAR(256) NOT NULL,
  "runAttempt" VARCHAR(256) NOT NULL,
  "verifierRevision" VARCHAR(256) NOT NULL,
  "sourceCommit" VARCHAR(40) NOT NULL CHECK ("sourceCommit" ~ '^[a-f0-9]{40}$'),
  "sourceTree" VARCHAR(40) NOT NULL CHECK ("sourceTree" ~ '^[a-f0-9]{40}$'),
  "requestDigest" VARCHAR(71) NOT NULL CHECK ("requestDigest" ~ '^sha256:[a-f0-9]{64}$'),
  "requestWire" BYTEA NOT NULL CHECK (octet_length("requestWire") BETWEEN 1 AND 1048576),
  "grantDigest" VARCHAR(71) NOT NULL CHECK ("grantDigest" ~ '^sha256:[a-f0-9]{64}$'),
  "grantWire" BYTEA NOT NULL CHECK (octet_length("grantWire") BETWEEN 1 AND 1048576),
  "candidateArchive" BYTEA NOT NULL CHECK (octet_length("candidateArchive") BETWEEN 1 AND 8388608),
  "candidateArchiveSha256" VARCHAR(71) NOT NULL CHECK ("candidateArchiveSha256" ~ '^sha256:[a-f0-9]{64}$'),
  "candidateArchiveSha512Sri" VARCHAR(95) NOT NULL CHECK ("candidateArchiveSha512Sri" ~ '^sha512-[A-Za-z0-9+/]{86}==$'),
  "releasedArchive" BYTEA NOT NULL CHECK (octet_length("releasedArchive") BETWEEN 1 AND 8388608),
  "releasedArchiveSha256" VARCHAR(71) NOT NULL CHECK ("releasedArchiveSha256" ~ '^sha256:[a-f0-9]{64}$'),
  "releasedArchiveSha512Sri" VARCHAR(95) NOT NULL CHECK ("releasedArchiveSha512Sri" ~ '^sha512-[A-Za-z0-9+/]{86}==$'),
  "toolArchive" BYTEA NOT NULL CHECK (octet_length("toolArchive") BETWEEN 1 AND 16777216),
  "toolArchiveSha256" VARCHAR(71) NOT NULL CHECK ("toolArchiveSha256" ~ '^sha256:[a-f0-9]{64}$'),
  "toolArchiveSha512Sri" VARCHAR(95) NOT NULL CHECK ("toolArchiveSha512Sri" ~ '^sha512-[A-Za-z0-9+/]{86}==$'),
  "installedDistributionWire" BYTEA NOT NULL CHECK (octet_length("installedDistributionWire") BETWEEN 1 AND 2097152),
  "installedDistributionDigest" VARCHAR(71) NOT NULL CHECK ("installedDistributionDigest" ~ '^sha256:[a-f0-9]{64}$'),
  "completionDigest" VARCHAR(71) CHECK ("completionDigest" IS NULL OR "completionDigest" ~ '^sha256:[a-f0-9]{64}$'),
  "completionWire" BYTEA CHECK ("completionWire" IS NULL OR octet_length("completionWire") BETWEEN 1 AND 1048576),
  "reportDigest" VARCHAR(71) CHECK ("reportDigest" IS NULL OR "reportDigest" ~ '^sha256:[a-f0-9]{64}$'),
  "finalizedReport" BYTEA CHECK ("finalizedReport" IS NULL OR octet_length("finalizedReport") BETWEEN 1 AND 16777216),
  "receiptDigest" VARCHAR(71) CHECK ("receiptDigest" IS NULL OR "receiptDigest" ~ '^sha256:[a-f0-9]{64}$'),
  "receiptWire" BYTEA CHECK ("receiptWire" IS NULL OR octet_length("receiptWire") BETWEEN 1 AND 1048576),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMPTZ(3),
  CONSTRAINT "SdkGrowthAuthorityCustody_completion_shape" CHECK (
    ("completionDigest" IS NULL AND "completionWire" IS NULL AND
     "reportDigest" IS NULL AND "finalizedReport" IS NULL AND
     "receiptDigest" IS NULL AND "receiptWire" IS NULL AND "completedAt" IS NULL)
    OR
    ("completionDigest" IS NOT NULL AND "completionWire" IS NOT NULL AND
     "reportDigest" IS NOT NULL AND "finalizedReport" IS NOT NULL AND
     "receiptDigest" IS NOT NULL AND "receiptWire" IS NOT NULL AND "completedAt" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "SdkGrowthAuthorityCustody_request_key"
  ON "SdkGrowthAuthorityCustody" ("tenantId", "repositoryId", "pullRequest", "runId", "runAttempt", "verifierRevision", "requestDigest");
CREATE INDEX "SdkGrowthAuthorityCustody_execution_idx"
  ON "SdkGrowthAuthorityCustody" ("tenantId", "repositoryId", "pullRequest", "runId", "runAttempt");

CREATE TABLE "SdkGrowthPublicationEffect" (
  "custodyId" TEXT PRIMARY KEY REFERENCES "SdkGrowthAuthorityCustody"("custodyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "intentId" TEXT NOT NULL UNIQUE,
  "state" TEXT NOT NULL CHECK ("state" IN ('pending', 'queued', 'sending', 'reconcile-required', 'superseded', 'not-applied', 'applied')),
  "claimId" TEXT,
  "claimVersion" BIGINT NOT NULL DEFAULT 0 CHECK ("claimVersion" >= 0),
  "attemptId" TEXT,
  "providerCorrelation" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "SdkGrowthPublicationEffect_pending_idx"
  ON "SdkGrowthPublicationEffect" ("state", "createdAt");

-- Verifier-owned source custody. No authority HTTP path can write these rows.
CREATE TABLE "SdkGrowthVerifierEvidence" (
  "evidenceId" TEXT PRIMARY KEY,
  "tenantId" VARCHAR(256) NOT NULL,
  "repositoryId" VARCHAR(256) NOT NULL,
  "githubRepositoryId" VARCHAR(256) NOT NULL,
  "installationId" VARCHAR(256) NOT NULL,
  "subject" VARCHAR(256) NOT NULL,
  "runId" VARCHAR(256) NOT NULL,
  "runAttempt" VARCHAR(256) NOT NULL,
  "verifierRevision" VARCHAR(40) NOT NULL CHECK ("verifierRevision" ~ '^[a-f0-9]{40}$'),
  "sourceCommit" VARCHAR(40) NOT NULL CHECK ("sourceCommit" ~ '^[a-f0-9]{40}$'),
  "sourceTree" VARCHAR(40) NOT NULL CHECK ("sourceTree" ~ '^[a-f0-9]{40}$'),
  "producer" TEXT NOT NULL CHECK ("producer" = 'reviewrouter-verifier'),
  "candidateWritable" BOOLEAN NOT NULL DEFAULT FALSE CHECK ("candidateWritable" = FALSE),
  "authorityBinding" JSONB NOT NULL CHECK (octet_length("authorityBinding"::text) BETWEEN 2 AND 400000),
  "candidateArchive" BYTEA NOT NULL CHECK (octet_length("candidateArchive") BETWEEN 1 AND 8388608),
  "candidateArchiveSha256" VARCHAR(71) NOT NULL CHECK ("candidateArchiveSha256" ~ '^sha256:[a-f0-9]{64}$'),
  "candidateArchiveSha512Sri" VARCHAR(95) NOT NULL CHECK ("candidateArchiveSha512Sri" ~ '^sha512-[A-Za-z0-9+/]{86}==$'),
  "releasedArchive" BYTEA NOT NULL CHECK (octet_length("releasedArchive") BETWEEN 1 AND 8388608),
  "releasedArchiveSha256" VARCHAR(71) NOT NULL CHECK ("releasedArchiveSha256" ~ '^sha256:[a-f0-9]{64}$'),
  "releasedArchiveSha512Sri" VARCHAR(95) NOT NULL CHECK ("releasedArchiveSha512Sri" ~ '^sha512-[A-Za-z0-9+/]{86}==$'),
  "toolArchive" BYTEA NOT NULL CHECK (octet_length("toolArchive") BETWEEN 1 AND 16777216),
  "toolArchiveSha256" VARCHAR(71) NOT NULL CHECK ("toolArchiveSha256" ~ '^sha256:[a-f0-9]{64}$'),
  "toolArchiveSha512Sri" VARCHAR(95) NOT NULL CHECK ("toolArchiveSha512Sri" ~ '^sha512-[A-Za-z0-9+/]{86}==$'),
  "installedDistributionWire" BYTEA NOT NULL CHECK (octet_length("installedDistributionWire") BETWEEN 1 AND 2097152),
  "installedDistributionDigest" VARCHAR(71) NOT NULL CHECK ("installedDistributionDigest" ~ '^sha256:[a-f0-9]{64}$'),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "SdkGrowthVerifierEvidence_execution_idx"
  ON "SdkGrowthVerifierEvidence" ("tenantId", "repositoryId", "runId", "runAttempt");

CREATE TABLE "SdkGrowthFinalizedReportEvidence" (
  "reportEvidenceId" TEXT PRIMARY KEY,
  "evidenceId" TEXT NOT NULL REFERENCES "SdkGrowthVerifierEvidence"("evidenceId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "repositoryId" VARCHAR(256) NOT NULL,
  "runId" VARCHAR(256) NOT NULL,
  "runAttempt" VARCHAR(256) NOT NULL,
  "verifierRevision" VARCHAR(40) NOT NULL CHECK ("verifierRevision" ~ '^[a-f0-9]{40}$'),
  "producer" TEXT NOT NULL CHECK ("producer" = 'reviewrouter-verifier'),
  "candidateWritable" BOOLEAN NOT NULL DEFAULT FALSE CHECK ("candidateWritable" = FALSE),
  "reportDigest" VARCHAR(71) NOT NULL CHECK ("reportDigest" ~ '^sha256:[a-f0-9]{64}$'),
  "finalizedReport" BYTEA NOT NULL CHECK (octet_length("finalizedReport") BETWEEN 1 AND 16777216),
  "grantId" VARCHAR(2048) NOT NULL,
  "outcome" TEXT NOT NULL CHECK ("outcome" IN ('passed', 'failed')),
  "coverage" TEXT NOT NULL CHECK ("coverage" IN ('complete', 'partial', 'unavailable')),
  "coveredScopes" JSONB NOT NULL CHECK (jsonb_typeof("coveredScopes") = 'array' AND jsonb_array_length("coveredScopes") <= 1024),
  "phases" JSONB NOT NULL CHECK (jsonb_typeof("phases") = 'array' AND jsonb_array_length("phases") BETWEEN 1 AND 1024),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SdkGrowthFinalizedReportEvidence_digest_key" UNIQUE ("evidenceId", "reportDigest")
);

CREATE FUNCTION sdk_growth_verifier_evidence_preserve() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'SDK growth verifier evidence is immutable';
END;
$$;
CREATE TRIGGER sdk_growth_verifier_evidence_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON "SdkGrowthVerifierEvidence"
  FOR EACH STATEMENT EXECUTE FUNCTION sdk_growth_verifier_evidence_preserve();
CREATE TRIGGER sdk_growth_finalized_report_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON "SdkGrowthFinalizedReportEvidence"
  FOR EACH STATEMENT EXECUTE FUNCTION sdk_growth_verifier_evidence_preserve();

CREATE FUNCTION sdk_growth_custody_preserve() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'SDK growth custody cannot be deleted';
  END IF;
  IF ROW(
    NEW."custodyId", NEW."tenantId", NEW."repositoryId", NEW."pullRequest",
    NEW."githubRepositoryId", NEW."installationId", NEW."subject",
    NEW."runId", NEW."runAttempt", NEW."verifierRevision",
    NEW."sourceCommit", NEW."sourceTree", NEW."requestDigest", NEW."requestWire",
    NEW."grantDigest", NEW."grantWire", NEW."candidateArchive",
    NEW."candidateArchiveSha256", NEW."candidateArchiveSha512Sri",
    NEW."releasedArchive", NEW."releasedArchiveSha256", NEW."releasedArchiveSha512Sri",
    NEW."toolArchive", NEW."toolArchiveSha256", NEW."toolArchiveSha512Sri",
    NEW."installedDistributionWire", NEW."installedDistributionDigest", NEW."createdAt"
  ) IS DISTINCT FROM ROW(
    OLD."custodyId", OLD."tenantId", OLD."repositoryId", OLD."pullRequest",
    OLD."githubRepositoryId", OLD."installationId", OLD."subject",
    OLD."runId", OLD."runAttempt", OLD."verifierRevision",
    OLD."sourceCommit", OLD."sourceTree", OLD."requestDigest", OLD."requestWire",
    OLD."grantDigest", OLD."grantWire", OLD."candidateArchive",
    OLD."candidateArchiveSha256", OLD."candidateArchiveSha512Sri",
    OLD."releasedArchive", OLD."releasedArchiveSha256", OLD."releasedArchiveSha512Sri",
    OLD."toolArchive", OLD."toolArchiveSha256", OLD."toolArchiveSha512Sri",
    OLD."installedDistributionWire", OLD."installedDistributionDigest", OLD."createdAt"
  ) THEN
    RAISE EXCEPTION 'SDK growth admission custody is immutable';
  END IF;
  IF OLD."completionDigest" IS NOT NULL AND ROW(
    NEW."completionDigest", NEW."completionWire", NEW."reportDigest",
    NEW."finalizedReport", NEW."receiptDigest", NEW."receiptWire", NEW."completedAt"
  ) IS DISTINCT FROM ROW(
    OLD."completionDigest", OLD."completionWire", OLD."reportDigest",
    OLD."finalizedReport", OLD."receiptDigest", OLD."receiptWire", OLD."completedAt"
  ) THEN
    RAISE EXCEPTION 'SDK growth completion custody is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sdk_growth_custody_immutable
  BEFORE UPDATE OR DELETE ON "SdkGrowthAuthorityCustody"
  FOR EACH ROW EXECUTE FUNCTION sdk_growth_custody_preserve();
CREATE TRIGGER sdk_growth_custody_no_truncate
  BEFORE TRUNCATE ON "SdkGrowthAuthorityCustody"
  FOR EACH STATEMENT EXECUTE FUNCTION sdk_growth_custody_preserve();

CREATE FUNCTION sdk_growth_publication_preserve() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'SDK growth publication effects cannot be deleted';
  END IF;
  IF NEW."custodyId" IS DISTINCT FROM OLD."custodyId"
     OR NEW."intentId" IS DISTINCT FROM OLD."intentId"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
     OR NEW."claimVersion" < OLD."claimVersion" THEN
    RAISE EXCEPTION 'SDK growth publication identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sdk_growth_publication_immutable
  BEFORE UPDATE OR DELETE ON "SdkGrowthPublicationEffect"
  FOR EACH ROW EXECUTE FUNCTION sdk_growth_publication_preserve();
CREATE TRIGGER sdk_growth_publication_no_truncate
  BEFORE TRUNCATE ON "SdkGrowthPublicationEffect"
  FOR EACH STATEMENT EXECUTE FUNCTION sdk_growth_publication_preserve();

-- Bound the retained generation at the JSON-safe contract range.
ALTER TABLE "SdkGrowthCurrentAuthority"
  ADD CONSTRAINT "SdkGrowthCurrentAuthority_epoch_safe"
  CHECK ("epoch" BETWEEN 0 AND 9007199254740991);
