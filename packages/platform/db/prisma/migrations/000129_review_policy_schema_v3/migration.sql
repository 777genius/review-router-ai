-- Current schemaVersion 3 stores its canonical policy document here. Existing
-- rows without it remain opaque historical evidence and are not execution input.
ALTER TABLE "ReviewConfigurationVersion"
ADD COLUMN "policyJson" TEXT;

-- Approved agent definitions extend the existing immutable producer registry.
ALTER TABLE "ProducerRelease" ADD COLUMN "agentProfilesJson" TEXT;
