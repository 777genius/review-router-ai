-- The shared permit remains held across bounded native transport. An exclusive
-- pause waits for admitted sends to exit, then prevents any newer submission.
CREATE TABLE "MemoryKnowledgeMaintenanceFence" (
  "generation" TEXT PRIMARY KEY, "epoch" BIGINT NOT NULL DEFAULT 0,
  "paused" BOOLEAN NOT NULL DEFAULT FALSE, "actor" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MemoryKnowledgeMaintenanceFence_epoch_check" CHECK ("epoch" >= 0)
);
INSERT INTO "MemoryKnowledgeMaintenanceFence" ("generation","epoch","paused","actor")
  SELECT DISTINCT "generation",0,FALSE,'forward_migration' FROM "MemoryKnowledgeScopeState";
ALTER TABLE "MemoryKnowledgeBundleReceipt" ADD COLUMN "snapshotHash" TEXT;
CREATE UNIQUE INDEX "MemoryKnowledgeBundleReceipt_authorizationId_snapshotHash_key"
  ON "MemoryKnowledgeBundleReceipt"("authorizationId", "snapshotHash");
