BEGIN;
CREATE TABLE "ReviewSkill" (
  "id" TEXT PRIMARY KEY, "sourceWorkspaceId" TEXT NOT NULL REFERENCES "Workspace"("id") ON DELETE RESTRICT,
  "authorUserId" TEXT NOT NULL, "headRevisionId" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMPTZ(3)
);
CREATE TABLE "ReviewSkillRevision" (
  "id" TEXT PRIMARY KEY, "skillId" TEXT NOT NULL REFERENCES "ReviewSkill"("id") ON DELETE RESTRICT,
  "revisionNumber" INTEGER NOT NULL CHECK ("revisionNumber" > 0),
  "name" TEXT NOT NULL CHECK (length("name") BETWEEN 1 AND 120 AND btrim("name") <> ''),
  "description" TEXT NOT NULL CHECK (length("description") <= 1024),
  "instructions" TEXT NOT NULL CHECK (octet_length("instructions") BETWEEN 1 AND 32768 AND btrim("instructions") <> ''),
  "contentDigest" VARCHAR(71) NOT NULL CHECK ("contentDigest" ~ '^sha256:[a-f0-9]{64}$'),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("id", "skillId"), UNIQUE ("skillId", "revisionNumber")
);
ALTER TABLE "ReviewSkill" ADD CONSTRAINT "ReviewSkill_headRevisionId_id_fkey"
  FOREIGN KEY ("headRevisionId", "id") REFERENCES "ReviewSkillRevision"("id", "skillId")
  ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX "ReviewSkill_sourceWorkspaceId_id_idx" ON "ReviewSkill"("sourceWorkspaceId", "id");
CREATE TABLE "ReviewSkillGrant" (
  "skillId" TEXT NOT NULL REFERENCES "ReviewSkill"("id") ON DELETE RESTRICT,
  "destinationWorkspaceId" TEXT NOT NULL REFERENCES "Workspace"("id") ON DELETE RESTRICT,
  "grantedBy" TEXT NOT NULL, "grantedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMPTZ(3), "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
  PRIMARY KEY ("skillId", "destinationWorkspaceId")
);
CREATE INDEX "ReviewSkillGrant_destinationWorkspaceId_skillId_idx" ON "ReviewSkillGrant"("destinationWorkspaceId", "skillId");
CREATE TABLE "ReviewSkillLink" (
  "workspaceId" TEXT NOT NULL REFERENCES "Workspace"("id") ON DELETE RESTRICT,
  "skillId" TEXT NOT NULL REFERENCES "ReviewSkill"("id") ON DELETE RESTRICT,
  "acceptedGrantVersion" INTEGER NOT NULL CHECK ("acceptedGrantVersion" > 0), "acceptedBy" TEXT NOT NULL,
  "acceptedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "unlinkedAt" TIMESTAMPTZ(3),
  PRIMARY KEY ("workspaceId", "skillId")
);
CREATE TABLE "ReviewSkillBinding" (
  "workspaceId" TEXT NOT NULL, "repositoryConnectionId" TEXT NOT NULL,
  "skillId" TEXT NOT NULL REFERENCES "ReviewSkill"("id") ON DELETE RESTRICT,
  "includePaths" JSONB NOT NULL, "excludePaths" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
  PRIMARY KEY ("repositoryConnectionId", "skillId"),
  FOREIGN KEY ("repositoryConnectionId", "workspaceId") REFERENCES "RepositoryConnection"("id", "workspaceId") ON DELETE RESTRICT,
  CHECK (jsonb_typeof("includePaths") = 'array' AND jsonb_array_length("includePaths") BETWEEN 1 AND 16),
  CHECK (jsonb_typeof("excludePaths") = 'array' AND jsonb_array_length("excludePaths") <= 16)
);
CREATE INDEX "ReviewSkillBinding_workspaceId_skillId_idx" ON "ReviewSkillBinding"("workspaceId", "skillId");
CREATE TABLE "ReviewSkillRepositorySource" (
  "repositoryConnectionId" TEXT PRIMARY KEY REFERENCES "RepositoryConnection"("id") ON DELETE RESTRICT,
  "roots" JSONB NOT NULL CHECK (jsonb_typeof("roots") = 'array' AND jsonb_array_length("roots") <= 2),
  "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0)
);
CREATE FUNCTION rr_review_skill_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_TABLE_NAME = 'ReviewSkillRevision' THEN
    RAISE EXCEPTION 'review_skill_revision_immutable' USING ERRCODE='23514';
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."sourceWorkspaceId" IS DISTINCT FROM OLD."sourceWorkspaceId"
    OR NEW."authorUserId" IS DISTINCT FROM OLD."authorUserId" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'review_skill_identity_immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER review_skill_revision_immutable BEFORE UPDATE OR DELETE ON "ReviewSkillRevision"
  FOR EACH ROW EXECUTE FUNCTION rr_review_skill_immutable();
CREATE TRIGGER review_skill_identity_immutable BEFORE UPDATE ON "ReviewSkill"
  FOR EACH ROW EXECUTE FUNCTION rr_review_skill_immutable();
REVOKE ALL ON FUNCTION rr_review_skill_immutable() FROM PUBLIC;

-- RepositoryConnection is SELECT-only for runtime roles. Keep the bounded row
-- lock under the existing NOLOGIN schema owner, without granting column writes.
CREATE FUNCTION public.rr_review_skills_repository_lock(
  p_workspace_id text,
  p_repository_connection_ids text[]
)
RETURNS TABLE(id text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT repository."id"
  FROM public."RepositoryConnection" AS repository
  WHERE cardinality(p_repository_connection_ids) BETWEEN 1 AND 1000
    AND repository."workspaceId" = p_workspace_id
    AND repository."id" = ANY(p_repository_connection_ids)
    AND repository."selected" = true
    AND repository."archived" = false
  ORDER BY repository."id"
  FOR SHARE OF repository
$function$;

DO $review_skills_repository_owner_handoff$
DECLARE temporary_create boolean := false;
BEGIN
  IF NOT pg_catalog.has_schema_privilege(
    'reviewrouter_release_schema_owner', 'public', 'CREATE') THEN
    GRANT CREATE ON SCHEMA public TO reviewrouter_release_schema_owner;
    temporary_create := true;
  END IF;
  ALTER FUNCTION public.rr_review_skills_repository_lock(text, text[])
    OWNER TO reviewrouter_release_schema_owner;
  IF temporary_create THEN
    REVOKE CREATE ON SCHEMA public FROM reviewrouter_release_schema_owner;
  END IF;
END $review_skills_repository_owner_handoff$;

REVOKE ALL ON FUNCTION public.rr_review_skills_repository_lock(text, text[])
  FROM PUBLIC;
-- Web-only EXECUTE is projected by canonical runtime ACL convergence.
COMMIT;
