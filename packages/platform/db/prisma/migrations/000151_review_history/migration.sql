ALTER TABLE "ReviewRequestedIntent" ADD COLUMN "historyRootRequestId" TEXT;
ALTER TABLE "ReviewExecutionV2" ADD COLUMN "historyRootRequestId" TEXT, ADD COLUMN "historyDispatchAttempt" INTEGER;
CREATE TABLE "ReviewHistoryCoverage" (
  "id" TEXT PRIMARY KEY, "coverageSince" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "ReviewHistoryPullRequest" (
  "id" TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL REFERENCES "Workspace"("id") ON DELETE CASCADE,
  "scmRepositoryIdentityId" TEXT NOT NULL,
  "pullRequestNumber" INTEGER NOT NULL CHECK ("pullRequestNumber">0),
  "lastAllocatedRunSequence" BIGINT NOT NULL DEFAULT 0 CHECK ("lastAllocatedRunSequence">=0),
  "latestRootRequestId" TEXT, "latestRunSequence" BIGINT, "latestRequestedAt" TIMESTAMP(3),
  "latestStatus" TEXT, "repositoryFullName" TEXT, "pullRequestTitle" TEXT,
  "sourceBaseUrl" TEXT, "projectedAt" TIMESTAMP(3),
  "searchDocument" tsvector GENERATED ALWAYS AS (to_tsvector('simple',coalesce("pullRequestTitle",'') || ' ' || coalesce("repositoryFullName",''))) STORED,
  UNIQUE ("workspaceId","scmRepositoryIdentityId","pullRequestNumber"),
  CHECK (("latestRootRequestId" IS NULL)=("latestRunSequence" IS NULL)),
  CHECK (("latestRootRequestId" IS NULL)=("latestRequestedAt" IS NULL))
);
CREATE INDEX "ReviewHistoryPullRequest_workspaceId_latestRequestedAt_id_idx" ON "ReviewHistoryPullRequest"("workspaceId","latestRequestedAt","id");
CREATE INDEX "ReviewHistoryPullRequest_workspaceId_scmRepositoryIdentityId_l_idx" ON "ReviewHistoryPullRequest"("workspaceId","scmRepositoryIdentityId","latestRequestedAt","id");
CREATE INDEX "ReviewHistoryPullRequest_workspaceId_latestStatus_latestReque_idx" ON "ReviewHistoryPullRequest"("workspaceId","latestStatus","latestRequestedAt","id");
CREATE INDEX "ReviewHistoryPullRequest_workspaceId_pullRequestNumber_latest_idx" ON "ReviewHistoryPullRequest"("workspaceId","pullRequestNumber","latestRequestedAt","id");
CREATE INDEX "ReviewHistoryPullRequest_search_idx" ON "ReviewHistoryPullRequest" USING GIN ("searchDocument");
CREATE TABLE "ReviewHistoryRun" (
  "rootRequestId" TEXT PRIMARY KEY,
  "pullRequestId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL REFERENCES "Workspace"("id") ON DELETE CASCADE,
  "scmRepositoryIdentityId" TEXT NOT NULL, "pullRequestNumber" INTEGER NOT NULL,
  "originalRepositoryConnectionId" TEXT NOT NULL,
  "runSequence" BIGINT NOT NULL CHECK ("runSequence">0),
  "requestedAt" TIMESTAMP(3) NOT NULL, "triggerKind" TEXT NOT NULL,
  "headSha" TEXT NOT NULL, "reviewRevisionHash" TEXT NOT NULL,
  "repositoryFullName" TEXT, "pullRequestTitle" TEXT, "sourceBaseUrl" TEXT NOT NULL,
  "boundExecutionId" TEXT, "boundDispatchAttempt" INTEGER,
  "selectedDispatchAttempt" INTEGER NOT NULL DEFAULT 0,
  "intentCursor" JSONB, "executionCursor" JSONB, "completionCursor" JSONB,
  "status" TEXT, "projectedAt" TIMESTAMP(3), "updatedAt" TIMESTAMP(3) NOT NULL,
  UNIQUE ("workspaceId","scmRepositoryIdentityId","pullRequestNumber","runSequence"),
  CHECK (("boundExecutionId" IS NULL)=("boundDispatchAttempt" IS NULL))
);
CREATE INDEX "ReviewHistoryRun_workspaceId_pullRequestId_runSequence_idx" ON "ReviewHistoryRun"("workspaceId","pullRequestId","runSequence");
