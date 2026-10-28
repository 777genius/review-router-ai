CREATE TABLE "UsageSourceFact" ("sourceInstance" TEXT NOT NULL, "eventId" TEXT NOT NULL, "revision" INTEGER NOT NULL CHECK ("revision" > 0), "hash" TEXT NOT NULL, "callId" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "fact" JSONB NOT NULL, "occurredAt" TIMESTAMPTZ(3) NOT NULL, "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY ("sourceInstance","eventId","revision"));
CREATE INDEX "UsageSourceFact_callId_idx" ON "UsageSourceFact"("callId");
CREATE INDEX "UsageSourceFact_receivedAt_idx" ON "UsageSourceFact"("receivedAt");
CREATE TABLE "UsageCall" ("callId" TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, "actorId" TEXT, "provider" TEXT NOT NULL, "actualModel" TEXT, "route" TEXT NOT NULL, "bindingId" TEXT, "runId" TEXT, "purpose" TEXT NOT NULL, "occurredAt" TIMESTAMPTZ(3) NOT NULL, "identityHash" TEXT NOT NULL, "projection" JSONB NOT NULL, "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "UsageCall_workspaceId_occurredAt_provider_actualModel_idx" ON "UsageCall"("workspaceId","occurredAt","provider","actualModel");
CREATE TABLE "UsageDedupeTombstone" ("sourceInstance" TEXT NOT NULL, "eventId" TEXT NOT NULL, "callId" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "identityHash" TEXT NOT NULL, "lastRevision" INTEGER NOT NULL, "lastHash" TEXT NOT NULL, "lastAcceptedAt" TIMESTAMPTZ(3) NOT NULL, "expiresAt" TIMESTAMPTZ(3) NOT NULL, PRIMARY KEY("sourceInstance","eventId"));
CREATE INDEX "UsageDedupeTombstone_expiresAt_idx" ON "UsageDedupeTombstone"("expiresAt");
CREATE TABLE "UsageSourceCheckpoint" ("sourceInstance" TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, "cursor" TEXT, "highWaterMark" TEXT, "fence" BIGINT NOT NULL DEFAULT 0, "leaseOwner" TEXT, "leaseUntil" TIMESTAMPTZ(3), "coveredFrom" TIMESTAMPTZ(3) NOT NULL, "asOf" TIMESTAMPTZ(3), "disabledAt" TIMESTAMPTZ(3));
CREATE TABLE "UsageIngestionConflict" ("id" TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, "sourceInstance" TEXT NOT NULL, "eventId" TEXT NOT NULL, "revision" INTEGER NOT NULL, "code" TEXT NOT NULL, "incomingHash" TEXT NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "UsageIngestionConflict_workspaceId_createdAt_idx" ON "UsageIngestionConflict"("workspaceId","createdAt");
CREATE TABLE "ProviderUsageGrant" ("id" TEXT PRIMARY KEY, "tokenHash" TEXT NOT NULL UNIQUE, "workspaceId" TEXT NOT NULL, "invocationId" TEXT NOT NULL, "repositoryId" TEXT NOT NULL, "runId" TEXT NOT NULL, "runAttempt" INTEGER NOT NULL, "authorizationId" TEXT NOT NULL, "actorId" TEXT, "bindingId" TEXT, "producerDigest" TEXT NOT NULL, "workflowIdentity" TEXT NOT NULL, "jobIdentity" TEXT NOT NULL, "publicKey" TEXT NOT NULL, "issuedAt" TIMESTAMPTZ(3) NOT NULL, "expiresAt" TIMESTAMPTZ(3) NOT NULL, "closedAt" TIMESTAMPTZ(3), "revokedAt" TIMESTAMPTZ(3));
CREATE INDEX "ProviderUsageGrant_workspaceId_invocationId_idx" ON "ProviderUsageGrant"("workspaceId","invocationId");

ALTER TABLE "ProviderUsageGrant" ADD COLUMN "recoveryClaimToken" TEXT, ADD COLUMN "recoveryClaimUntil" TIMESTAMPTZ(3), ADD COLUMN "recoveryNextAttemptAt" TIMESTAMPTZ(3), ADD COLUMN "recoveredAt" TIMESTAMPTZ(3);
CREATE TABLE "UsageUnattributedObservation" ("sourceInstance" TEXT NOT NULL,"eventId" TEXT NOT NULL,"revision" INTEGER NOT NULL,"hash" TEXT NOT NULL,"payload" JSONB NOT NULL,"workspaceId" TEXT,"observedAt" TIMESTAMPTZ(3) NOT NULL,"receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"reason" TEXT NOT NULL,"resolvedAt" TIMESTAMPTZ(3),PRIMARY KEY("sourceInstance","eventId","revision"));
CREATE INDEX "UsageUnattributedObservation_receivedAt_idx" ON "UsageUnattributedObservation"("receivedAt");
-- The existing workspace deletion transition is the authority. Serializes against
-- ingest's workspace row lock and closes usage ingestion before any erasure retry.
CREATE FUNCTION reviewrouter_delete_workspace_usage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."deletionState" <> 'active' AND OLD."deletionState" = 'active' THEN
    UPDATE "ProviderUsageGrant" SET "revokedAt"=CURRENT_TIMESTAMP WHERE "workspaceId"=NEW."id";
    UPDATE "UsageSourceCheckpoint" SET "disabledAt"=CURRENT_TIMESTAMP,"leaseOwner"=NULL,"leaseUntil"=NULL WHERE "workspaceId"=NEW."id";
    DELETE FROM "UsageSourceFact" WHERE "workspaceId"=NEW."id";
    DELETE FROM "UsageCall" WHERE "workspaceId"=NEW."id";
    DELETE FROM "UsageUnattributedObservation" WHERE "workspaceId"=NEW."id";
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Workspace_usage_deletion" AFTER UPDATE OF "deletionState" ON "Workspace" FOR EACH ROW EXECUTE FUNCTION reviewrouter_delete_workspace_usage();

ALTER TABLE "ProviderUsageGrant" ADD COLUMN "githubInstallationId" TEXT, ADD COLUMN "repositoryFullName" TEXT, ADD COLUMN "artifactDeletedAt" TIMESTAMPTZ(3);

ALTER TABLE "UsageSourceCheckpoint" ADD COLUMN "failureCount" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "nextAttemptAt" TIMESTAMPTZ(3), ADD COLUMN "deadLetteredAt" TIMESTAMPTZ(3), ADD COLUMN "lastErrorCode" TEXT;

ALTER TABLE "UsageUnattributedObservation" ADD COLUMN "nextResolutionAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "UsageUnattributedObservation_resolvedAt_nextResolutionAt_idx" ON "UsageUnattributedObservation"("resolvedAt","nextResolutionAt");

ALTER TABLE "ProviderUsageGrant" ADD COLUMN "priceSnapshot" JSONB;

ALTER TABLE "ProviderUsageGrant" ADD COLUMN "producerCoverage" JSONB;
CREATE INDEX "ProviderUsageGrant_workspaceId_actorId_idx" ON "ProviderUsageGrant"("workspaceId","actorId");
CREATE INDEX "ProviderUsageGrant_revokedAt_artifactDeletedAt_idx" ON "ProviderUsageGrant"("revokedAt","artifactDeletedAt");
CREATE INDEX "ProviderUsageGrant_recoveredAt_recoveryNextAttemptAt_idx" ON "ProviderUsageGrant"("recoveredAt","recoveryNextAttemptAt");
CREATE INDEX "UsageSourceCheckpoint_workspaceId_idx" ON "UsageSourceCheckpoint"("workspaceId");

ALTER TABLE "ProviderUsageGrant" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'review', ADD COLUMN "bootstrapLeaseId" TEXT;

ALTER TABLE "ProviderUsageGrant" ADD COLUMN "bootstrapScope" JSONB;

ALTER TABLE "ProviderUsageGrant" ADD COLUMN "actionSessionScope" JSONB;
