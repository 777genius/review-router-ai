ALTER TABLE "ProducerRelease" ADD COLUMN "contextToolsProfile" JSONB;

CREATE TABLE "ReviewContextConnection" (
    "workspaceId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "definition" JSONB NOT NULL,
    "encryptedSecrets" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReviewContextConnection_pkey" PRIMARY KEY ("workspaceId", "connectionId"),
    CONSTRAINT "ReviewContextConnection_revision_positive" CHECK ("revision" > 0)
);
