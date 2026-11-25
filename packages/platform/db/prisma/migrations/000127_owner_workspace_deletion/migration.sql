-- Stable support/operator workspace deletion. Existing workspace identity and
-- every historical Restrict relationship remain physically intact.
CREATE TYPE "WorkspaceDeletionState" AS ENUM ('active', 'delete_pending', 'deleted');
CREATE TYPE "WorkspaceDeletionStage" AS ENUM
  ('delete_pending', 'fences_pending', 'execution_closure_pending',
   'erase_pending', 'finalize_pending', 'deleted', 'refused');
CREATE TYPE "WorkspaceDeletionFactKind" AS ENUM
  ('binding_fence', 'execution_closure', 'generation_erasure',
   'inert_readback', 'final_scope');

ALTER TABLE "Workspace"
  ADD COLUMN "deletionState" "WorkspaceDeletionState" NOT NULL DEFAULT 'active',
  ADD COLUMN "deletionRevision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "deletionTombstonedAt" TIMESTAMP(3);
ALTER TABLE "Workspace"
  ADD CONSTRAINT "Workspace_deletionRevision_check" CHECK ("deletionRevision" >= 1);

CREATE TABLE "WorkspaceDeletionOperation" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "expectedWorkspaceRevision" INTEGER NOT NULL,
  "normalizedIntentHash" TEXT NOT NULL,
  "actorRef" TEXT NOT NULL,
  "stage" "WorkspaceDeletionStage" NOT NULL,
  "stageReason" TEXT NOT NULL,
  "targets" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "WorkspaceDeletionOperation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WorkspaceDeletionOperation_workspaceId_key"
  ON "WorkspaceDeletionOperation"("workspaceId");
CREATE INDEX "WorkspaceDeletionOperation_stage_updatedAt_idx"
  ON "WorkspaceDeletionOperation"("stage", "updatedAt");
ALTER TABLE "WorkspaceDeletionOperation"
  ADD CONSTRAINT "WorkspaceDeletionOperation_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "WorkspaceDeletionFact" (
  "id" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "kind" "WorkspaceDeletionFactKind" NOT NULL,
  "subjectRef" TEXT NOT NULL,
  "proofRef" TEXT NOT NULL,
  "detail" JSONB NOT NULL,
  "digest" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkspaceDeletionFact_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WorkspaceDeletionFact_operationId_kind_subjectRef_key"
  ON "WorkspaceDeletionFact"("operationId", "kind", "subjectRef");
CREATE INDEX "WorkspaceDeletionFact_operationId_createdAt_idx"
  ON "WorkspaceDeletionFact"("operationId", "createdAt");
ALTER TABLE "WorkspaceDeletionFact"
  ADD CONSTRAINT "WorkspaceDeletionFact_operationId_fkey"
  FOREIGN KEY ("operationId") REFERENCES "WorkspaceDeletionOperation"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION "rr_workspace_delete_admission"("p_workspaceId" TEXT)
RETURNS boolean LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog AS $$
DECLARE permitted boolean;
BEGIN
  SELECT "deletionState" = 'active' INTO permitted FROM public."Workspace"
  WHERE "id" = "p_workspaceId" FOR SHARE;
  RETURN COALESCE(permitted, false);
END $$;

CREATE FUNCTION "rr_workspace_member_delete_admission"()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW."workspaceId" <> OLD."workspaceId" THEN
    IF NOT "rr_workspace_delete_admission"(NEW."workspaceId") THEN
      RAISE EXCEPTION 'workspace_deletion_admission_denied';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "WorkspaceMember_delete_admission"
BEFORE INSERT OR UPDATE ON "WorkspaceMember"
FOR EACH ROW EXECUTE FUNCTION "rr_workspace_member_delete_admission"();

CREATE FUNCTION "rr_provider_connection_delete_admission"()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR COALESCE(NEW."ownerWorkspaceId", '') <> COALESCE(OLD."ownerWorkspaceId", '')
     OR COALESCE(NEW."ownerUserId", '') <> COALESCE(OLD."ownerUserId", '')
     OR (NEW."state" IN ('active', 'pending') AND (
          NEW."state" IS DISTINCT FROM OLD."state"
          OR NEW."metadataRevision" IS DISTINCT FROM OLD."metadataRevision"
          OR NEW."gatewayAccountRef" IS DISTINCT FROM OLD."gatewayAccountRef"
          OR NEW."pendingSourceOperationId" IS DISTINCT FROM OLD."pendingSourceOperationId")) THEN
    IF TG_OP = 'UPDATE' AND (
      OLD."ownerWorkspaceId" IS DISTINCT FROM NEW."ownerWorkspaceId" OR
      OLD."ownerUserId" IS DISTINCT FROM NEW."ownerUserId") THEN
      IF OLD."ownerWorkspaceId" IS NOT NULL AND NOT public."rr_workspace_delete_admission"(OLD."ownerWorkspaceId") THEN
        RAISE EXCEPTION 'workspace_deletion_admission_denied';
      END IF;
      IF OLD."ownerUserId" IS NOT NULL AND NOT COALESCE((
        SELECT public."rr_workspace_delete_admission"("id") FROM public."Workspace"
        WHERE "personalOwnerUserId" = OLD."ownerUserId"), false) THEN
        RAISE EXCEPTION 'workspace_deletion_admission_denied';
      END IF;
    END IF;
    IF NEW."ownerWorkspaceId" IS NOT NULL
       AND NOT "rr_workspace_delete_admission"(NEW."ownerWorkspaceId") THEN
      RAISE EXCEPTION 'workspace_deletion_admission_denied';
    END IF;
    IF NEW."ownerUserId" IS NOT NULL AND NOT COALESCE((
      SELECT public."rr_workspace_delete_admission"("id") FROM public."Workspace"
      WHERE "personalOwnerUserId" = NEW."ownerUserId"), false) THEN
      RAISE EXCEPTION 'workspace_deletion_admission_denied';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ProviderAccountConnection_delete_admission"
BEFORE INSERT OR UPDATE ON "ProviderAccountConnection"
FOR EACH ROW EXECUTE FUNCTION "rr_provider_connection_delete_admission"();

CREATE FUNCTION "rr_workspace_binding_delete_admission"()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE ownerWorkspaceId TEXT; ownerUserId TEXT;
BEGIN
  SELECT "ownerWorkspaceId", "ownerUserId" INTO ownerWorkspaceId, ownerUserId
  FROM "ProviderAccountConnection" WHERE "id" = NEW."connectionId";
  IF TG_OP = 'INSERT'
     OR NEW."workspaceId" <> OLD."workspaceId"
     OR NEW."connectionId" <> OLD."connectionId"
     OR (NEW."state" = 'active' AND OLD."state" <> 'active') THEN
    IF NOT "rr_workspace_delete_admission"(NEW."workspaceId")
       OR (ownerWorkspaceId IS NOT NULL
           AND NOT "rr_workspace_delete_admission"(ownerWorkspaceId))
       OR (ownerUserId IS NOT NULL AND NOT COALESCE((
         SELECT public."rr_workspace_delete_admission"("id") FROM public."Workspace"
         WHERE "personalOwnerUserId" = ownerUserId), false)) THEN
      RAISE EXCEPTION 'workspace_deletion_admission_denied';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "WorkspaceAccountBinding_delete_admission"
BEFORE INSERT OR UPDATE ON "WorkspaceAccountBinding"
FOR EACH ROW EXECUTE FUNCTION "rr_workspace_binding_delete_admission"();

CREATE FUNCTION "rr_personal_operation_delete_admission"()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR NEW."personalWorkspaceId" <> OLD."personalWorkspaceId"
     OR COALESCE(NEW."targetWorkspaceId", '') <> COALESCE(OLD."targetWorkspaceId", '')
     OR (NEW."phase" IN ('submitted', 'applied')
         AND OLD."phase" NOT IN ('submitted', 'applied')) THEN
    IF NOT "rr_workspace_delete_admission"(NEW."personalWorkspaceId")
       OR (NEW."targetWorkspaceId" IS NOT NULL
           AND NOT "rr_workspace_delete_admission"(NEW."targetWorkspaceId")) THEN
      RAISE EXCEPTION 'workspace_deletion_admission_denied';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "PersonalAccountOperation_delete_admission"
BEFORE INSERT OR UPDATE ON "PersonalAccountOperation"
FOR EACH ROW EXECUTE FUNCTION "rr_personal_operation_delete_admission"();

CREATE FUNCTION "rr_review_run_delete_admission"()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR NEW."workspaceId" <> OLD."workspaceId"
     OR NEW."gatewayExecutionCanonicalJson" IS DISTINCT FROM OLD."gatewayExecutionCanonicalJson"
     OR (NEW."state" = 'active' AND OLD."state" <> 'active') THEN
    IF NOT "rr_workspace_delete_admission"(NEW."workspaceId") THEN
      RAISE EXCEPTION 'workspace_deletion_admission_denied';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ReviewRunAuthorization_delete_admission"
BEFORE INSERT OR UPDATE ON "ReviewRunAuthorization"
FOR EACH ROW EXECUTE FUNCTION "rr_review_run_delete_admission"();

CREATE FUNCTION "rr_workspace_deletion_fact_immutable"()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION 'workspace_deletion_fact_immutable';
END $$;
CREATE TRIGGER "WorkspaceDeletionFact_immutable"
BEFORE UPDATE OR DELETE ON "WorkspaceDeletionFact"
FOR EACH ROW EXECUTE FUNCTION "rr_workspace_deletion_fact_immutable"();
