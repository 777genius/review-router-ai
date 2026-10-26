-- Provider registry storage. Existing rows keep every value: the projection
-- columns become nullable for later writers, new columns are NULL or default.
BEGIN;

CREATE TYPE "ProviderCredentialKind" AS ENUM ('gateway_binding', 'managed_api_key', 'hosted_pool', 'repository_rotating', 'user_ci_secret');

ALTER TABLE "Workspace" ADD COLUMN "providerManagementAdminOnly" BOOLEAN NOT NULL DEFAULT false;

-- The first-provider projection is history of schema 1-3 versions only. Its
-- CHECKs stay; a NULL passes them. reasoningEffort is nullable since 000142.
ALTER TABLE "ReviewConfigurationVersion"
  ALTER COLUMN "providerKind" DROP NOT NULL,
  ALTER COLUMN "providerAuthMode" DROP NOT NULL,
  ALTER COLUMN "model" DROP NOT NULL,
  ALTER COLUMN "failOnSeverity" DROP NOT NULL,
  ALTER COLUMN "inlineMaxComments" DROP NOT NULL,
  ALTER COLUMN "targetTokensPerBatch" DROP NOT NULL;

-- What the attempt's and the last confirmed workflow were rendered for: the
-- transport plus the provider kinds the file carries, e.g. ci_secrets+claude.
-- NULL is unknown: rows before this migration never derive a required update.
ALTER TABLE "WorkflowProvisioning"
  ADD COLUMN "attemptWorkflowRequirement" TEXT,
  ADD COLUMN "installedWorkflowRequirement" TEXT,
  ADD CONSTRAINT "WorkflowProvisioning_workflow_requirement" CHECK (
    ("attemptWorkflowRequirement" IS NULL
      OR "attemptWorkflowRequirement" ~ '^(gateway|provider_api|rotating|hosted_pool|ci_secrets)(\+[a-z][a-z0-9-]{0,31}){0,4}$')
    AND ("installedWorkflowRequirement" IS NULL
      OR "installedWorkflowRequirement" ~ '^(gateway|provider_api|rotating|hosted_pool|ci_secrets)(\+[a-z][a-z0-9-]{0,31}){0,4}$')
  );

CREATE TABLE "WorkspaceProviderProfile" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "credentialKind" "ProviderCredentialKind" NOT NULL,
    "authMode" TEXT NOT NULL,
    "gatewayBindingId" TEXT,
    "gatewayProfileRef" TEXT,
    "apiKeyConnectionId" TEXT,
    "repositoryId" TEXT,
    "model" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "identityKey" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceProviderProfile_pkey" PRIMARY KEY ("id"),
    -- Each credential kind delivers only its own auth modes.
    CONSTRAINT "WorkspaceProviderProfile_auth_mode" CHECK (
      ("credentialKind" = 'gateway_binding' AND "authMode" = 'codex_account_gateway')
      OR ("credentialKind" = 'managed_api_key'
        AND "authMode" IN ('mimo_token_plan_api_key', 'openrouter_api_key'))
      OR ("credentialKind" = 'hosted_pool'
        AND "authMode" = 'codex_subscription_oauth_hosted_pool')
      OR ("credentialKind" = 'repository_rotating'
        AND "authMode" = 'codex_subscription_oauth_rotating')
      OR ("credentialKind" = 'user_ci_secret'
        AND "authMode" IN ('mimo_token_plan_api_key', 'claude_code_oauth'))
    ),
    -- Exactly the reference of the credential kind is set.
    CONSTRAINT "WorkspaceProviderProfile_credential_reference" CHECK (
      ("gatewayBindingId" IS NOT NULL) = ("credentialKind" = 'gateway_binding')
      AND ("gatewayProfileRef" IS NOT NULL) = ("credentialKind" = 'gateway_binding')
      AND ("apiKeyConnectionId" IS NOT NULL) = ("credentialKind" = 'managed_api_key')
      AND ("repositoryId" IS NOT NULL) = ("credentialKind" = 'repository_rotating')
    ),
    -- Archiving releases the identity so the same provider can be created again.
    CONSTRAINT "WorkspaceProviderProfile_identity_archive" CHECK (
      ("identityKey" IS NULL) = ("archivedAt" IS NOT NULL)
    ),
    -- Labels, models and references are names, never credentials.
    CONSTRAINT "WorkspaceProviderProfile_non_secret" CHECK (
      "label" !~ '^(sk-|ghp_|github_pat_|xox[baprs]-)'
      AND "model" !~ '^(sk-|ghp_|github_pat_|xox[baprs]-)'
      AND ("gatewayProfileRef" IS NULL
        OR "gatewayProfileRef" !~ '^(sk-|ghp_|github_pat_|xox[baprs]-)')
    )
);

CREATE INDEX "WorkspaceProviderProfile_createdByUserId_idx" ON "WorkspaceProviderProfile"("createdByUserId");
CREATE INDEX "WorkspaceProviderProfile_gatewayBindingId_workspaceId_idx" ON "WorkspaceProviderProfile"("gatewayBindingId", "workspaceId");
CREATE INDEX "WorkspaceProviderProfile_apiKeyConnectionId_workspaceId_idx" ON "WorkspaceProviderProfile"("apiKeyConnectionId", "workspaceId");
CREATE INDEX "WorkspaceProviderProfile_repositoryId_workspaceId_idx" ON "WorkspaceProviderProfile"("repositoryId", "workspaceId");
CREATE UNIQUE INDEX "WorkspaceProviderProfile_workspaceId_identityKey_key" ON "WorkspaceProviderProfile"("workspaceId", "identityKey");

-- Composite keys keep every reference inside the profile's workspace. Key and
-- binding references use NO ACTION so a cascading workspace delete is not blocked.
ALTER TABLE "WorkspaceProviderProfile" ADD CONSTRAINT "WorkspaceProviderProfile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceProviderProfile" ADD CONSTRAINT "WorkspaceProviderProfile_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkspaceProviderProfile" ADD CONSTRAINT "WorkspaceProviderProfile_gatewayBindingId_workspaceId_fkey" FOREIGN KEY ("gatewayBindingId", "workspaceId") REFERENCES "WorkspaceAccountBinding"("id", "workspaceId") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "WorkspaceProviderProfile" ADD CONSTRAINT "WorkspaceProviderProfile_apiKeyConnectionId_workspaceId_fkey" FOREIGN KEY ("apiKeyConnectionId", "workspaceId") REFERENCES "ProviderApiKeyConnection"("id", "workspaceId") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "WorkspaceProviderProfile" ADD CONSTRAINT "WorkspaceProviderProfile_repositoryId_workspaceId_fkey" FOREIGN KEY ("repositoryId", "workspaceId") REFERENCES "RepositoryConnection"("id", "workspaceId") ON DELETE CASCADE ON UPDATE NO ACTION;

-- The credential source and the creator are fixed at creation, so an edit can
-- never change the workflow transport. Deleting the creator only clears it.
CREATE FUNCTION workspace_provider_profile_credential_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."workspaceId", NEW."credentialKind", NEW."authMode", NEW."gatewayBindingId",
         NEW."gatewayProfileRef", NEW."apiKeyConnectionId", NEW."repositoryId")
       IS DISTINCT FROM
     ROW(OLD."workspaceId", OLD."credentialKind", OLD."authMode", OLD."gatewayBindingId",
         OLD."gatewayProfileRef", OLD."apiKeyConnectionId", OLD."repositoryId")
     OR (NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId"
       AND NEW."createdByUserId" IS NOT NULL) THEN
    RAISE EXCEPTION 'workspace_provider_profile_credential_immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "WorkspaceProviderProfile_credential_immutable"
  BEFORE UPDATE ON "WorkspaceProviderProfile"
  FOR EACH ROW EXECUTE FUNCTION workspace_provider_profile_credential_immutable();

COMMIT;
