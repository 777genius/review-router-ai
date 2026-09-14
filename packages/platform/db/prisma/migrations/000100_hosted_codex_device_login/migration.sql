SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

-- Short-lived dashboard device-auth flights. deviceAuthId is the right to
-- receive a refresh token; keep it server-only and wipe it on any terminal
-- status. Tokens themselves are never stored in this table.
CREATE TYPE "HostedCodexDeviceLoginStatus" AS ENUM (
  'pending',
  'imported',
  'failed',
  'expired'
);

CREATE TABLE "HostedCodexDeviceLogin" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "actor" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "priority" INTEGER NOT NULL,
  "userCode" TEXT NOT NULL,
  "verificationUrl" TEXT NOT NULL,
  "deviceAuthId" TEXT,
  "status" "HostedCodexDeviceLoginStatus" NOT NULL DEFAULT 'pending',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HostedCodexDeviceLogin_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HostedCodexDeviceLogin_actor_label_check" CHECK (
    char_length("actor") BETWEEN 1 AND 160
    AND char_length("label") BETWEEN 1 AND 80
    AND "priority" >= 0
  ),
  CONSTRAINT "HostedCodexDeviceLogin_user_code_check" CHECK (
    char_length("userCode") BETWEEN 4 AND 64
    AND "userCode" ~ '^[A-Za-z0-9-]+$'
  ),
  CONSTRAINT "HostedCodexDeviceLogin_verification_url_check" CHECK (
    char_length("verificationUrl") BETWEEN 16 AND 512
    AND "verificationUrl" LIKE 'https://auth.openai.com/%'
  ),
  CONSTRAINT "HostedCodexDeviceLogin_device_auth_lifecycle_check" CHECK (
    (
      "status" = 'pending'
      AND "deviceAuthId" IS NOT NULL
      AND char_length("deviceAuthId") BETWEEN 8 AND 256
    )
    OR (
      "status" IN ('imported', 'failed', 'expired')
      AND "deviceAuthId" IS NULL
    )
  )
);

CREATE UNIQUE INDEX "HostedCodexDeviceLogin_one_pending_per_workspace_key"
  ON "HostedCodexDeviceLogin"("workspaceId")
  WHERE "status" = 'pending';

CREATE INDEX "HostedCodexDeviceLogin_workspaceId_status_expiresAt_idx"
  ON "HostedCodexDeviceLogin"("workspaceId", "status", "expiresAt");

CREATE INDEX "HostedCodexDeviceLogin_id_workspaceId_actor_idx"
  ON "HostedCodexDeviceLogin"("id", "workspaceId", "actor");

ALTER TABLE "HostedCodexDeviceLogin"
  ADD CONSTRAINT "HostedCodexDeviceLogin_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
