-- Current approved bodies belong to the complete memory provider. The only
-- content below is a bounded immutable unresolved-delivery envelope.
CREATE TABLE "MemoryKnowledgeScopeState" (
  "generation" TEXT NOT NULL, "scopeKey" TEXT NOT NULL, "workspaceId" TEXT NOT NULL,
  "epoch" BIGINT NOT NULL DEFAULT 0, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("generation", "scopeKey")
);
CREATE INDEX "MemoryKnowledgeScopeState_workspaceId_idx" ON "MemoryKnowledgeScopeState"("workspaceId");
CREATE TABLE "MemoryKnowledgeEntry" (
  "generation" TEXT NOT NULL, "scopeKey" TEXT NOT NULL, "entryId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL, "revision" INTEGER NOT NULL, "lifecycle" TEXT NOT NULL,
  "metadata" JSONB NOT NULL, "pendingCommandId" TEXT, "revocationCommandId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("generation", "scopeKey", "entryId"),
  CONSTRAINT "MemoryKnowledgeEntry_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "MemoryKnowledgeEntry_lifecycle_check" CHECK ("lifecycle" IN ('active','retired','expired','forget_pending','forgotten')),
  CONSTRAINT "MemoryKnowledgeEntry_metadata_no_body" CHECK (NOT ("metadata" ?| ARRAY['body','content','topicIds','text','rawSource']))
);
CREATE INDEX "MemoryKnowledgeEntry_workspaceId_lifecycle_idx" ON "MemoryKnowledgeEntry"("workspaceId","lifecycle");
CREATE INDEX "MemoryKnowledgeEntry_generation_scopeKey_entryId_idx" ON "MemoryKnowledgeEntry"("generation","scopeKey","entryId");
CREATE TABLE "MemoryKnowledgeCommand" (
  "id" TEXT PRIMARY KEY, "generation" TEXT NOT NULL, "scopeKey" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL, "entryId" TEXT NOT NULL, "revision" INTEGER NOT NULL,
  "commandKind" TEXT NOT NULL, "digest" TEXT NOT NULL, "approval" JSONB NOT NULL, "envelope" JSONB,
  "state" TEXT NOT NULL, "safeReason" TEXT, "contentApprovalRevision" TEXT NOT NULL,
  "originalStatementAt" TEXT, "deliveryExpiresAt" TIMESTAMP(3) NOT NULL, "resubmitUntil" TIMESTAMP(3) NOT NULL,
  "claimId" TEXT, "claimUntil" TIMESTAMP(3), "firstDispatchedAt" TIMESTAMP(3), "deliveryAttempt" INTEGER NOT NULL DEFAULT 0, "cleanupReceiptId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MemoryKnowledgeCommand_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "MemoryKnowledgeCommand_kind_check" CHECK ("commandKind" IN ('save','topics','retire','expire','forget')),
  CONSTRAINT "MemoryKnowledgeCommand_state_check" CHECK ("state" IN ('queued','submitted','processing','published','failed','unknown','cleanup_pending','completed')),
  CONSTRAINT "MemoryKnowledgeCommand_digest_check" CHECK ("digest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "MemoryKnowledgeCommand_resubmit_window" CHECK ("resubmitUntil" <= "deliveryExpiresAt"),
  CONSTRAINT "MemoryKnowledgeCommand_bounded_envelope" CHECK ("envelope" IS NULL OR octet_length("envelope"::text) <= 16384),
  CONSTRAINT "MemoryKnowledgeCommand_terminal_envelope" CHECK ("state" NOT IN ('published','completed','failed') OR "envelope" IS NULL)
);
CREATE UNIQUE INDEX "MemoryKnowledgeCommand_generation_scopeKey_entryId_revision_key" ON "MemoryKnowledgeCommand"("generation","scopeKey","entryId","revision");
CREATE INDEX "MemoryKnowledgeCommand_generation_scopeKey_entryId_state_idx" ON "MemoryKnowledgeCommand"("generation","scopeKey","entryId","state");
CREATE INDEX "MemoryKnowledgeCommand_state_deliveryExpiresAt_idx" ON "MemoryKnowledgeCommand"("state","deliveryExpiresAt");
CREATE TABLE "MemoryKnowledgeSourceCursor" (
  "key" TEXT PRIMARY KEY, "generation" TEXT NOT NULL, "workspaceId" TEXT NOT NULL,
  "revision" TEXT NOT NULL, "sourceAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "MemoryKnowledgeSourceCursor_workspaceId_idx" ON "MemoryKnowledgeSourceCursor"("workspaceId");
CREATE TABLE "MemoryKnowledgeBundleReceipt" (
  "id" TEXT PRIMARY KEY, "authorizationId" TEXT NOT NULL, "bindingDigest" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL, "receipt" JSONB NOT NULL, "policyVersion" INTEGER NOT NULL,
  "eligibilityEpoch" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "MemoryKnowledgeBundleReceipt_expiresAt_idx" ON "MemoryKnowledgeBundleReceipt"("expiresAt");

-- Prevent changed-payload UUID reuse and accidental content-envelope editing.
CREATE FUNCTION memory_knowledge_command_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."generation" IS DISTINCT FROM OLD."generation"
    OR NEW."scopeKey" IS DISTINCT FROM OLD."scopeKey" OR NEW."entryId" IS DISTINCT FROM OLD."entryId"
    OR NEW."revision" IS DISTINCT FROM OLD."revision" OR NEW."digest" IS DISTINCT FROM OLD."digest"
    OR NEW."commandKind" IS DISTINCT FROM OLD."commandKind"
    OR NEW."approval" IS DISTINCT FROM OLD."approval" OR NEW."workspaceId" IS DISTINCT FROM OLD."workspaceId"
    OR NEW."contentApprovalRevision" IS DISTINCT FROM OLD."contentApprovalRevision" OR NEW."originalStatementAt" IS DISTINCT FROM OLD."originalStatementAt"
    OR NEW."deliveryExpiresAt" IS DISTINCT FROM OLD."deliveryExpiresAt" OR NEW."resubmitUntil" IS DISTINCT FROM OLD."resubmitUntil"
    OR (NEW."envelope" IS DISTINCT FROM OLD."envelope" AND NEW."envelope" IS NOT NULL) THEN
    RAISE EXCEPTION 'memory_command_immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "MemoryKnowledgeCommand_immutable" BEFORE UPDATE ON "MemoryKnowledgeCommand"
  FOR EACH ROW EXECUTE FUNCTION memory_knowledge_command_immutable();

-- Usage retains stable logical entry IDs after canonical-item removal. Historical
-- migration files and usage rows remain intact; no implicit cascade data loss.
ALTER TABLE "MemoryUsageEvent" DROP CONSTRAINT IF EXISTS "MemoryUsageEvent_memoryItemId_fkey";
