BEGIN;
-- A recreated assignment must never accept the previous assignment's Paths CAS.
ALTER TABLE "ReviewSkillBinding"
  ADD COLUMN "generation" TEXT NOT NULL DEFAULT gen_random_uuid()::text;

-- Historical originals have no operation identity. New create commands supply a
-- stable identity scoped to their author and workspace for exact response retries.
ALTER TABLE "ReviewSkill" ADD COLUMN "createOperationId" TEXT;
CREATE UNIQUE INDEX "ReviewSkill_sourceWorkspaceId_authorUserId_createOperationId_key"
  ON "ReviewSkill" ("sourceWorkspaceId", "authorUserId", "createOperationId");
COMMIT;
