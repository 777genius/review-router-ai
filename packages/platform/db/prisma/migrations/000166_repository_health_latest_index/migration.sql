CREATE INDEX CONCURRENTLY "ActionRunHealthReport_workspace_repository_latest_idx"
ON "ActionRunHealthReport" ("workspaceId", "repositoryId", "receivedAt" DESC, "id" DESC);
