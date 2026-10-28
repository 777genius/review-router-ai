-- Inactive G1 fixture custody. Production tool provenance and protected runner
-- installation require a later, separately accepted activation checkpoint.
CREATE TABLE "SdkGrowthV3ToolArtifact" (
  "artifactId" VARCHAR(64) PRIMARY KEY,
  "packageName" VARCHAR(128) NOT NULL,
  "packageVersion" VARCHAR(128) NOT NULL,
  "sourceCommit" VARCHAR(40) NOT NULL,
  "sourceTree" VARCHAR(40) NOT NULL,
  "installedDistributionDigest" VARCHAR(71) NOT NULL,
  "provenanceKind" VARCHAR(32) NOT NULL,
  "archive" BYTEA NOT NULL,
  "archiveByteLength" INTEGER NOT NULL,
  "archiveSha256" VARCHAR(71) NOT NULL,
  "archiveSha512Sri" VARCHAR(128) NOT NULL,
  "recordedAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "SdkGrowthV3ToolArtifact_id_check" CHECK ("artifactId" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "SdkGrowthV3ToolArtifact_package_check" CHECK ("packageName" = '@agent-teams/engineering-foundation'),
  CONSTRAINT "SdkGrowthV3ToolArtifact_source_check" CHECK ("sourceCommit" ~ '^[a-f0-9]{40}$' AND "sourceTree" ~ '^[a-f0-9]{40}$'),
  CONSTRAINT "SdkGrowthV3ToolArtifact_digest_check" CHECK (
    "installedDistributionDigest" ~ '^sha256:[a-f0-9]{64}$' AND
    "archiveSha256" ~ '^sha256:[a-f0-9]{64}$' AND
    "archiveSha512Sri" ~ '^sha512-[A-Za-z0-9+/]{86}==$'
  ),
  CONSTRAINT "SdkGrowthV3ToolArtifact_provenance_check" CHECK ("provenanceKind" = 'source-built-fixture'),
  CONSTRAINT "SdkGrowthV3ToolArtifact_archive_check" CHECK (
    "archiveByteLength" = octet_length("archive") AND
    "archiveByteLength" BETWEEN 1 AND 16777216
  )
);
CREATE TRIGGER sdk_growth_v3_tool_artifact_immutable
  BEFORE UPDATE OR DELETE ON "SdkGrowthV3ToolArtifact"
  FOR EACH ROW EXECUTE FUNCTION sdk_growth_snapshot_immutable();
CREATE TRIGGER sdk_growth_v3_tool_artifact_no_truncate
  BEFORE TRUNCATE ON "SdkGrowthV3ToolArtifact"
  FOR EACH STATEMENT EXECUTE FUNCTION sdk_growth_snapshot_immutable();

ALTER TABLE "SdkGrowthVerifierAssignment"
  ADD COLUMN "efToolArtifactId" VARCHAR(64) REFERENCES "SdkGrowthV3ToolArtifact"("artifactId") ON DELETE RESTRICT;
CREATE INDEX "SdkGrowthVerifierAssignment_tool_artifact_idx"
  ON "SdkGrowthVerifierAssignment" ("efToolArtifactId")
  WHERE "efToolArtifactId" IS NOT NULL;

CREATE OR REPLACE FUNCTION sdk_growth_verifier_assignment_immutable() RETURNS trigger
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
     OR NEW."efToolArtifactId" IS DISTINCT FROM OLD."efToolArtifactId"
     OR (OLD."revokedAt" IS NOT NULL AND NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt")
     OR (OLD."revokedAt" IS NULL AND NEW."revokedAt" IS NULL) THEN
    RAISE EXCEPTION 'verifier assignment is immutable except revocation';
  END IF;
  RETURN NEW;
END;
$$;
