-- reportEvidenceId is the SHA-256 identity of verifier evidence + logical
-- grant. The report digest is retained content, not conflict identity.
ALTER TABLE "SdkGrowthFinalizedReportEvidence"
  DROP CONSTRAINT "SdkGrowthFinalizedReportEvidence_digest_key";
