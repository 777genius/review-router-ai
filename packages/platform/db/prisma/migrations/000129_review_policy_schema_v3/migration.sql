-- Current schemaVersion 3 stores its canonical policy document here. Existing
-- rows without it remain opaque historical evidence and are not execution input.
ALTER TABLE "ReviewConfigurationVersion"
ADD COLUMN "policyJson" TEXT;

-- Approved agent definitions extend the existing immutable producer registry.
ALTER TABLE "ProducerRelease" ADD COLUMN "agentProfilesJson" TEXT;

-- Retain immutable historical v1 snapshots while admitting the current v2 wire
-- document. Runtime readers accept only v2; storage is not an execution parser.
ALTER TABLE "ReviewRunAuthorization"
DROP CONSTRAINT "ReviewRunAuthorization_runtime_snapshot_bound";
ALTER TABLE "ReviewRunAuthorization"
ADD CONSTRAINT "ReviewRunAuthorization_runtime_snapshot_bound"
  CHECK ("runtimeSnapshotCanonicalJson" IS NULL OR
    (octet_length("runtimeSnapshotCanonicalJson") BETWEEN 2 AND 32768 AND
     jsonb_typeof("runtimeSnapshotCanonicalJson"::jsonb) = 'object' AND
     "runtimeSnapshotCanonicalJson"::jsonb ->> 'snapshotVersion' IN ('1', '2')) IS TRUE);

-- A write receipt captures its effective result, while policyJson remains a
-- sparse override. Later inheritance edits or clearing do not rewrite receipts.
ALTER TABLE "ReviewConfigurationVersion" ADD COLUMN "operationSnapshotJson" TEXT;
