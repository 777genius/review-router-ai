BEGIN;
ALTER TABLE "GitHubUserAuthorization"
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "refreshAttemptId" TEXT;

ALTER TABLE "RepositoryPermissionCache"
  ADD COLUMN "authorizationAppSlug" TEXT,
  ADD COLUMN "authorizationRevision" INTEGER;

-- Disposable observations from old writers cannot be attributed to an authority
-- generation. New readers also reject null generations during a rolling update.
DELETE FROM "RepositoryPermissionCache";

COMMIT;
