CREATE TABLE "ReviewStatisticsCoverage" (
  "id" TEXT PRIMARY KEY CHECK ("id" = 'capture_v1'),
  "activatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "ReviewStatisticsReviewFact" (
  "executionId" TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "repositoryConnectionId" TEXT NOT NULL,
  "scmRepositoryIdentityId" TEXT NOT NULL,
  "pullRequestNumber" INTEGER NOT NULL CHECK ("pullRequestNumber" > 0),
  "settledAt" TIMESTAMP(3) NOT NULL,
  "payloadHash" TEXT NOT NULL,
  CONSTRAINT "ReviewStatisticsReviewFact_repository_tenant_fkey" FOREIGN KEY ("repositoryConnectionId", "workspaceId") REFERENCES "RepositoryConnection"("id", "workspaceId") ON DELETE CASCADE ON UPDATE RESTRICT
);
CREATE INDEX "statistics_review_workspace_time_idx" ON "ReviewStatisticsReviewFact"("workspaceId", "settledAt", "executionId");
CREATE INDEX "statistics_review_repository_idx" ON "ReviewStatisticsReviewFact"("repositoryConnectionId", "workspaceId");
CREATE TABLE "ReviewStatisticsIssueFact" (
  "id" TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "repositoryConnectionId" TEXT NOT NULL,
  "scmRepositoryIdentityId" TEXT NOT NULL,
  "pullRequestNumber" INTEGER NOT NULL CHECK ("pullRequestNumber" > 0),
  "lineageId" TEXT NOT NULL,
  "severity" TEXT NOT NULL CHECK ("severity" IN ('critical','major','minor','unknown')),
  "title" TEXT NOT NULL CHECK (char_length("title") <= 240),
  "caughtAt" TIMESTAMP(3) NOT NULL,
  "sourceExecutionId" TEXT NOT NULL,
  CONSTRAINT "ReviewStatisticsIssueFact_repository_tenant_fkey" FOREIGN KEY ("repositoryConnectionId", "workspaceId") REFERENCES "RepositoryConnection"("id", "workspaceId") ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "ReviewStatisticsIssueFact_lineage_key" UNIQUE ("workspaceId", "scmRepositoryIdentityId", "pullRequestNumber", "lineageId")
);
CREATE INDEX "statistics_issue_workspace_time_idx" ON "ReviewStatisticsIssueFact"("workspaceId", "caughtAt", "id");
CREATE INDEX "statistics_issue_severity_time_idx" ON "ReviewStatisticsIssueFact"("workspaceId", "severity", "caughtAt", "id");
CREATE INDEX "statistics_issue_repository_time_idx" ON "ReviewStatisticsIssueFact"("workspaceId", "repositoryConnectionId", "caughtAt", "id");
CREATE INDEX "statistics_issue_repo_severity_time_idx" ON "ReviewStatisticsIssueFact"("workspaceId", "repositoryConnectionId", "severity", "caughtAt", "id");
CREATE INDEX "statistics_issue_repository_idx" ON "ReviewStatisticsIssueFact"("repositoryConnectionId", "workspaceId");
