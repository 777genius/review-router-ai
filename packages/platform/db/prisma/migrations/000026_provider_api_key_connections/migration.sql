-- CreateTable
CREATE TABLE "ProviderApiKeyConnection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "providerType" TEXT NOT NULL,
    "encryptedApiKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderApiKeyConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderApiKeyRepositoryLink" (
    "id" TEXT NOT NULL,
    "providerApiKeyConnectionId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "lastErrorReason" TEXT,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderApiKeyRepositoryLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProviderApiKeyConnection_workspaceId_idx" ON "ProviderApiKeyConnection"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderApiKeyConnection_workspaceId_providerType_key" ON "ProviderApiKeyConnection"("workspaceId", "providerType");

-- CreateIndex
CREATE INDEX "ProviderApiKeyRepositoryLink_repositoryId_idx" ON "ProviderApiKeyRepositoryLink"("repositoryId");

-- CreateIndex
CREATE INDEX "ProviderApiKeyRepositoryLink_providerApiKeyConnectionId_sta_idx" ON "ProviderApiKeyRepositoryLink"("providerApiKeyConnectionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderApiKeyRepositoryLink_providerApiKeyConnectionId_rep_key" ON "ProviderApiKeyRepositoryLink"("providerApiKeyConnectionId", "repositoryId");

-- AddForeignKey
ALTER TABLE "ProviderApiKeyConnection" ADD CONSTRAINT "ProviderApiKeyConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderApiKeyRepositoryLink" ADD CONSTRAINT "ProviderApiKeyRepositoryLink_providerApiKeyConnectionId_fkey" FOREIGN KEY ("providerApiKeyConnectionId") REFERENCES "ProviderApiKeyConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderApiKeyRepositoryLink" ADD CONSTRAINT "ProviderApiKeyRepositoryLink_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "RepositoryConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
