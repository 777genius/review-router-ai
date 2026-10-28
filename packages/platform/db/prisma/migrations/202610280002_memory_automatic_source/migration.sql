-- Additive source lineage metadata; no provider content or existing generation changes.
CREATE TABLE "MemoryAutomaticSource" (
  "lineageKey" TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "scopeKey" TEXT NOT NULL,
  "state" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "MemoryAutomaticSource_workspaceId_scopeKey_idx" ON "MemoryAutomaticSource"("workspaceId","scopeKey");
CREATE TABLE "MemoryAutomaticEntry" (
  "generation" TEXT NOT NULL,
  "scopeKey" TEXT NOT NULL,
  "entryId" TEXT NOT NULL,
  "lineageKey" TEXT NOT NULL,
  "cohortId" TEXT NOT NULL,
  "epoch" TEXT NOT NULL,
  "bodyDigest" TEXT NOT NULL,
  "ownership" TEXT NOT NULL CHECK ("ownership" IN ('automatic','maintained')),
  PRIMARY KEY ("generation","scopeKey","entryId")
);
CREATE INDEX "MemoryAutomaticEntry_lineageKey_cohortId_idx" ON "MemoryAutomaticEntry"("lineageKey","cohortId");
