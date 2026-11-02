BEGIN;
CREATE TABLE "ReviewSkillImportCandidate" (
  "id" TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "actorUserId" TEXT NOT NULL,
  "name" TEXT NOT NULL CHECK (length("name") BETWEEN 1 AND 120 AND btrim("name") <> ''),
  "description" TEXT NOT NULL CHECK (length("description") <= 1024),
  "instructions" TEXT NOT NULL CHECK (octet_length("instructions") BETWEEN 1 AND 32768),
  "canonicalText" TEXT NOT NULL CHECK (octet_length("canonicalText") BETWEEN 1 AND 65536),
  "contentDigest" VARCHAR(71) NOT NULL CHECK ("contentDigest" ~ '^sha256:[a-f0-9]{64}$'),
  "sourceRepository" TEXT NOT NULL, "sourceCommit" VARCHAR(40) NOT NULL CHECK ("sourceCommit" ~ '^[a-f0-9]{40}$'),
  "sourcePath" TEXT NOT NULL, "sourceDigest" VARCHAR(71) NOT NULL CHECK ("sourceDigest" ~ '^sha256:[a-f0-9]{64}$'),
  "omittedFields" JSONB NOT NULL CHECK (jsonb_typeof("omittedFields")='array' AND jsonb_array_length("omittedFields")<=20),
  "hasResources" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL CHECK ("expiresAt">"createdAt"),
  "importedSkillId" TEXT REFERENCES "ReviewSkill"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "importedScanId" TEXT, "importIntentDigest" VARCHAR(71), "importedAt" TIMESTAMPTZ(3),
  UNIQUE ("id","workspaceId","actorUserId"),
  CHECK (("importedSkillId" IS NULL AND "importedScanId" IS NULL AND "importIntentDigest" IS NULL AND "importedAt" IS NULL)
    OR ("importedSkillId" IS NOT NULL AND "importedScanId" IS NOT NULL AND "importIntentDigest" ~ '^sha256:[a-f0-9]{64}$' AND "importedAt" IS NOT NULL))
);
CREATE INDEX "ReviewSkillImportCandidate_workspaceId_actorUserId_createdAt_idx" ON "ReviewSkillImportCandidate"("workspaceId","actorUserId","createdAt");
CREATE INDEX "ReviewSkillImportCandidate_expiresAt_idx" ON "ReviewSkillImportCandidate"("expiresAt");
CREATE TABLE "ReviewSkillScan" (
  "id" TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, "actorUserId" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL, "operationId" TEXT NOT NULL,
  "requestDigest" VARCHAR(71) NOT NULL CHECK ("requestDigest" ~ '^sha256:[a-f0-9]{64}$'),
  "contentDigest" VARCHAR(71) NOT NULL CHECK ("contentDigest" ~ '^sha256:[a-f0-9]{64}$'),
  "mode" TEXT NOT NULL CHECK ("mode" IN ('static','ai')),
  "profile" JSONB NOT NULL CHECK (jsonb_typeof("profile")='object'),
  "profileFingerprint" VARCHAR(71) NOT NULL CHECK ("profileFingerprint" ~ '^sha256:[a-f0-9]{64}$'),
  "reuseOfScanId" TEXT,
  "status" TEXT NOT NULL CHECK ("status" IN ('queued','running','completed','incomplete')),
  "report" JSONB CHECK ("report" IS NULL OR (jsonb_typeof("report")='object' AND octet_length("report"::text)<=100000)),
  "budgetUnits" INTEGER NOT NULL CHECK ("budgetUnits" BETWEEN 0 AND 4),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMPTZ(3), "completedAt" TIMESTAMPTZ(3), "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "claimId" TEXT, "claimVersion" BIGINT, "claimUntil" TIMESTAMPTZ(3), "executionDeadlineAt" TIMESTAMPTZ(3), "slotUntil" TIMESTAMPTZ(3),
  UNIQUE ("workspaceId","actorUserId","operationId"),
  UNIQUE ("id","workspaceId","contentDigest","profileFingerprint"),
  FOREIGN KEY ("candidateId","workspaceId","actorUserId") REFERENCES "ReviewSkillImportCandidate"("id","workspaceId","actorUserId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("reuseOfScanId","workspaceId","contentDigest","profileFingerprint") REFERENCES "ReviewSkillScan"("id","workspaceId","contentDigest","profileFingerprint") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK ("reuseOfScanId" IS NULL OR ("reuseOfScanId"<>"id" AND "budgetUnits"=0 AND "claimId" IS NULL AND "slotUntil" IS NULL)),
  CHECK ("status"<>'running' OR ("claimId" IS NOT NULL AND "claimVersion" IS NOT NULL AND "claimVersion">0 AND "claimUntil" IS NOT NULL AND "claimUntil">"executionDeadlineAt"+INTERVAL '10 seconds' AND "executionDeadlineAt" IS NOT NULL AND "slotUntil" IS NOT NULL))
);
CREATE INDEX "ReviewSkillScan_workspaceId_contentDigest_profileFingerprint_createdAt_idx" ON "ReviewSkillScan"("workspaceId","contentDigest","profileFingerprint","createdAt");
CREATE INDEX "ReviewSkillScan_slotUntil_idx" ON "ReviewSkillScan"("slotUntil");
CREATE INDEX "ReviewSkillScan_expiresAt_idx" ON "ReviewSkillScan"("expiresAt");

CREATE FUNCTION public.rr_skill_catalog_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $function$
BEGIN
  IF TG_OP='INSERT' THEN
    IF TG_TABLE_NAME='ReviewSkillImportCandidate' THEN
      IF NEW."importedSkillId" IS NOT NULL OR NEW."importedScanId" IS NOT NULL OR NEW."importIntentDigest" IS NOT NULL OR NEW."importedAt" IS NOT NULL THEN
        RAISE EXCEPTION 'skill_catalog_initial_receipt_invalid' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW."status"<>'queued' OR NEW."report" IS NOT NULL OR NEW."startedAt" IS NOT NULL OR NEW."completedAt" IS NOT NULL
      OR NEW."claimId" IS NOT NULL OR NEW."claimVersion" IS NOT NULL OR NEW."claimUntil" IS NOT NULL OR NEW."executionDeadlineAt" IS NOT NULL OR NEW."slotUntil" IS NOT NULL THEN
      RAISE EXCEPTION 'skill_scan_initial_state_invalid' USING ERRCODE='23514';
    END IF;
    IF NEW."reuseOfScanId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public."ReviewSkillScan" source WHERE source."id"=NEW."reuseOfScanId" AND source."reuseOfScanId" IS NULL
        AND source."workspaceId"=NEW."workspaceId" AND source."contentDigest"=NEW."contentDigest" AND source."profileFingerprint"=NEW."profileFingerprint") THEN
      RAISE EXCEPTION 'skill_scan_reuse_invalid' USING ERRCODE='23514';
    END IF;
  ELSIF TG_TABLE_NAME='ReviewSkillImportCandidate' THEN
    IF (to_jsonb(NEW)-ARRAY['importedSkillId','importedScanId','importIntentDigest','importedAt']) IS DISTINCT FROM
       (to_jsonb(OLD)-ARRAY['importedSkillId','importedScanId','importIntentDigest','importedAt'])
      OR (OLD."importedSkillId" IS NOT NULL AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD)) THEN
      RAISE EXCEPTION 'skill_catalog_candidate_immutable' USING ERRCODE='23514';
    END IF;
    IF NEW."importedSkillId" IS NOT NULL AND (NOT EXISTS (
      SELECT 1 FROM public."ReviewSkill" skill WHERE skill."id"=NEW."importedSkillId" AND skill."sourceWorkspaceId"=NEW."workspaceId"
        AND skill."authorUserId"=NEW."actorUserId" AND skill."createOperationId"=NEW."id") OR NOT EXISTS (
      SELECT 1 FROM public."ReviewSkillScan" scan WHERE scan."id"=NEW."importedScanId" AND scan."candidateId"=NEW."id"
        AND scan."workspaceId"=NEW."workspaceId" AND scan."actorUserId"=NEW."actorUserId")) THEN
      RAISE EXCEPTION 'skill_catalog_import_receipt_invalid' USING ERRCODE='23514';
    END IF;
  ELSE
    IF (to_jsonb(NEW)-ARRAY['status','report','startedAt','completedAt','claimId','claimVersion','claimUntil','executionDeadlineAt','slotUntil']) IS DISTINCT FROM
       (to_jsonb(OLD)-ARRAY['status','report','startedAt','completedAt','claimId','claimVersion','claimUntil','executionDeadlineAt','slotUntil'])
      OR (OLD."reuseOfScanId" IS NOT NULL AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD)) THEN
      RAISE EXCEPTION 'skill_scan_identity_immutable' USING ERRCODE='23514';
    END IF;
    IF (OLD."status" IN ('completed','incomplete') AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD))
      OR (OLD."status"='queued' AND NEW."status" NOT IN ('queued','running','incomplete'))
      OR (OLD."status"='running' AND (NEW."status" NOT IN ('running','completed','incomplete')
        OR NEW."claimId" IS DISTINCT FROM OLD."claimId" OR NEW."claimVersion" IS DISTINCT FROM OLD."claimVersion"
        OR NEW."claimUntil" IS DISTINCT FROM OLD."claimUntil" OR NEW."executionDeadlineAt" IS DISTINCT FROM OLD."executionDeadlineAt"
        OR NEW."slotUntil" IS NULL OR NEW."slotUntil">OLD."slotUntil")) THEN
      RAISE EXCEPTION 'skill_scan_transition_invalid' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER skill_catalog_candidate_immutable BEFORE INSERT OR UPDATE ON "ReviewSkillImportCandidate" FOR EACH ROW EXECUTE FUNCTION public.rr_skill_catalog_immutable();
CREATE TRIGGER skill_scan_identity_immutable BEFORE INSERT OR UPDATE ON "ReviewSkillScan" FOR EACH ROW EXECUTE FUNCTION public.rr_skill_catalog_immutable();
REVOKE ALL ON FUNCTION public.rr_skill_catalog_immutable() FROM PUBLIC;
COMMIT;
