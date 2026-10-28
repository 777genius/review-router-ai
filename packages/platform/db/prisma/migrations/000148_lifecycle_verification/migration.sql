BEGIN;
-- Additive capability rollout: old producer/snapshot bytes remain unchanged.
ALTER TABLE "ProducerRelease" ADD COLUMN "lifecycleVerificationProfile" JSONB;
ALTER TABLE "RepositoryConnection"
  ADD COLUMN "lifecycleResolutionMode" TEXT NOT NULL DEFAULT 'legacy_open',
  ADD COLUMN "lifecycleResolutionActivatedAt" TIMESTAMP(3),
  ADD COLUMN "lifecycleResolutionActivationVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lifecycleResolutionWriterDigest" TEXT,
  ADD COLUMN "lifecycleResolutionBootstrapJson" JSONB,
  ADD CONSTRAINT "RepositoryConnection_lifecycle_mode_check" CHECK ("lifecycleResolutionMode" IN ('legacy_open','draining','guarded')),
  ADD CONSTRAINT "RepositoryConnection_lifecycle_version_check" CHECK ("lifecycleResolutionActivationVersion" >= 0);

CREATE TABLE "ReviewRunCompanionDispatchV1" (
  "authorizationId" TEXT NOT NULL,
  "dispatchId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "executionId" TEXT NOT NULL,
  "workSlotId" TEXT NOT NULL,
  "attemptOrdinal" INTEGER NOT NULL,
  "leaseId" TEXT NOT NULL,
  "fencingToken" BIGINT NOT NULL,
  "preparedManifestKey" TEXT NOT NULL,
  "providerRequestEnvelopeHash" TEXT NOT NULL,
  "nativeRequestRef" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "usageHash" TEXT,
  "resultHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "claimedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  "retainUntil" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReviewRunCompanionDispatchV1_pkey" PRIMARY KEY ("authorizationId", "dispatchId"),
  CONSTRAINT "ReviewRunCompanionDispatchV1_role_check" CHECK ("role" IN ('lifecycle_verification','pr_description')),
  CONSTRAINT "ReviewRunCompanionDispatchV1_state_check" CHECK ("state" IN ('dispatch_may_have_started','not_dispatched','completed','effect_unknown')),
  CONSTRAINT "ReviewRunCompanionDispatchV1_attempt_check" CHECK ("attemptOrdinal" = 1),
  CONSTRAINT "ReviewRunCompanionDispatchV1_fence_check" CHECK ("fencingToken" >= 1)
);
CREATE UNIQUE INDEX "ReviewRunCompanionDispatchV1_authorizationId_workSlotId_att_key" ON "ReviewRunCompanionDispatchV1" ("authorizationId", "workSlotId", "attemptOrdinal");
CREATE INDEX "ReviewRunCompanionDispatchV1_retainUntil_idx" ON "ReviewRunCompanionDispatchV1" ("retainUntil");

CREATE TABLE "ReviewThreadResolutionGuardV1" (
  "workspaceId" TEXT NOT NULL,
  "repositoryConnectionId" TEXT NOT NULL,
  "scmRepositoryIdentityId" TEXT NOT NULL,
  "pullRequestNumber" INTEGER NOT NULL,
  "threadId" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 0,
  "confirmedFactJson" JSONB,
  "pendingFactsJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReviewThreadResolutionGuardV1_pkey" PRIMARY KEY ("workspaceId", "repositoryConnectionId", "scmRepositoryIdentityId", "pullRequestNumber", "threadId"),
  CONSTRAINT "ReviewThreadResolutionGuardV1_version_check" CHECK ("version" >= 0),
  CONSTRAINT "ReviewThreadResolutionGuardV1_pr_check" CHECK ("pullRequestNumber" >= 1)
);

ALTER TABLE "ReviewThreadResolutionGuardV1" ADD CONSTRAINT "ReviewThreadResolutionGuardV1_repositoryConnectionId_fkey" FOREIGN KEY ("repositoryConnectionId") REFERENCES "RepositoryConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
