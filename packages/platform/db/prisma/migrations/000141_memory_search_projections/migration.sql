-- Projection receipts are not canonical memory. Identity columns deliberately
-- have no foreign keys: remote cleanup must survive workspace/repository pruning.
CREATE TABLE "MemoryProjectionReceipt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "indexIdentity" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "memoryItemId" TEXT NOT NULL,
  "repositoryId" TEXT,
  "userId" TEXT,
  "scope" TEXT NOT NULL,
  "bodyVersion" INTEGER NOT NULL CHECK ("bodyVersion" > 0),
  "bodyHash" TEXT NOT NULL,
  "sequenceOrdinal" SERIAL NOT NULL CHECK ("sequenceOrdinal" > 0),
  "state" TEXT NOT NULL DEFAULT 'reserved',
  "remoteDocumentId" TEXT,
  "deleteRequested" BOOLEAN NOT NULL DEFAULT FALSE,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastErrorCode" TEXT,
  "retiredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MemoryProjectionReceipt_state_check" CHECK (
    "state" IN ('reserved', 'sent_unknown', 'accepted', 'indexed', 'deleted')
    AND ("state" NOT IN ('accepted', 'indexed') OR "remoteDocumentId" IS NOT NULL)
    AND ("state" NOT IN ('reserved', 'sent_unknown') OR "remoteDocumentId" IS NULL)
    AND ("state" <> 'deleted' OR "deleteRequested")
    AND ("retiredAt" IS NULL OR "state" = 'deleted')
  ),
  CONSTRAINT "MemoryProjectionReceipt_scope_check" CHECK (
    ("scope" = 'repository' AND "repositoryId" IS NOT NULL AND "userId" IS NULL)
    OR ("scope" = 'workspace' AND "repositoryId" IS NULL AND "userId" IS NULL)
    OR ("scope" = 'user_prefs' AND "repositoryId" IS NULL AND "userId" IS NOT NULL)
  ),
  CONSTRAINT "MemoryProjectionReceipt_error_code_check" CHECK (
    "lastErrorCode" IS NULL OR "lastErrorCode" IN (
      'memory_index_pending', 'memory_index_unavailable',
      'memory_index_conflict', 'memory_index_unknown_write'
    )
  )
);
CREATE UNIQUE INDEX "MemoryProjectionReceipt_sequenceOrdinal_key"
  ON "MemoryProjectionReceipt" ("sequenceOrdinal");
CREATE UNIQUE INDEX "MemoryProjectionReceipt_revision_key"
  ON "MemoryProjectionReceipt" ("indexIdentity", "workspaceId", "memoryItemId", "bodyVersion", "bodyHash");
CREATE INDEX "MemoryProjectionReceipt_due_idx"
  ON "MemoryProjectionReceipt" ("indexIdentity", "state", "nextAttemptAt");
CREATE INDEX "MemoryProjectionReceipt_item_idx"
  ON "MemoryProjectionReceipt" ("indexIdentity", "workspaceId", "memoryItemId");
