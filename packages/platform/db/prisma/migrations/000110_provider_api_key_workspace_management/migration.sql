CREATE TABLE "ProviderApiKeyWorkspaceGrant" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "grantedBy" TEXT,
    "grantReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderApiKeyWorkspaceGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProviderApiKeyWorkspaceGrant_workspaceId_key"
    ON "ProviderApiKeyWorkspaceGrant"("workspaceId");

CREATE TABLE "ProviderApiKeyConnection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "providerType" TEXT NOT NULL,
    "encryptedApiKey" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL,
    "latestOperationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderApiKeyConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProviderApiKeyConnection_workspaceId_providerType_key"
    ON "ProviderApiKeyConnection"("workspaceId", "providerType");

CREATE UNIQUE INDEX "ProviderApiKeyConnection_id_workspaceId_key"
    ON "ProviderApiKeyConnection"("id", "workspaceId");

CREATE INDEX "ProviderApiKeyConnection_workspaceId_idx"
    ON "ProviderApiKeyConnection"("workspaceId");

CREATE TABLE "ProviderApiKeyRepositoryLink" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "providerApiKeyConnectionId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "operationId" TEXT,
    "attemptedKeyVersion" INTEGER NOT NULL,
    "appliedKeyVersion" INTEGER,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "reconciliationNeeded" BOOLEAN NOT NULL DEFAULT false,
    "lastErrorReason" TEXT,
    "lastErrorSummary" TEXT,
    "lastAttemptAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderApiKeyRepositoryLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProviderApiKeyRepositoryLink_providerApiKeyConnectionId_repositoryId_key"
    ON "ProviderApiKeyRepositoryLink"("providerApiKeyConnectionId", "repositoryId");

CREATE INDEX "ProviderApiKeyRepositoryLink_repositoryId_idx"
    ON "ProviderApiKeyRepositoryLink"("repositoryId");

CREATE INDEX "ProviderApiKeyRepositoryLink_providerApiKeyConnectionId_status_idx"
    ON "ProviderApiKeyRepositoryLink"("providerApiKeyConnectionId", "status");

CREATE INDEX "ProviderApiKeyRepositoryLink_appliedKeyVersion_idx"
    ON "ProviderApiKeyRepositoryLink"("providerApiKeyConnectionId", "appliedKeyVersion");

ALTER TABLE "ProviderApiKeyWorkspaceGrant"
    ADD CONSTRAINT "ProviderApiKeyWorkspaceGrant_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProviderApiKeyConnection"
    ADD CONSTRAINT "ProviderApiKeyConnection_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProviderApiKeyRepositoryLink"
    ADD CONSTRAINT "ProviderApiKeyRepositoryLink_connection_workspace_fkey"
    FOREIGN KEY ("providerApiKeyConnectionId", "workspaceId")
    REFERENCES "ProviderApiKeyConnection"("id", "workspaceId")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProviderApiKeyRepositoryLink"
    ADD CONSTRAINT "ProviderApiKeyRepositoryLink_repository_workspace_fkey"
    FOREIGN KEY ("repositoryId", "workspaceId")
    REFERENCES "RepositoryConnection"("id", "workspaceId")
    ON DELETE CASCADE ON UPDATE CASCADE;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
            "ProviderApiKeyWorkspaceGrant",
            "ProviderApiKeyConnection",
            "ProviderApiKeyRepositoryLink"
        TO app;
    END IF;
END
$$;
