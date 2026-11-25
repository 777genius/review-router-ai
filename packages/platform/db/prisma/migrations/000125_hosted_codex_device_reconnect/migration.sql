-- Historical flights retain create intent. Reconnect is selected only at start.
ALTER TABLE "HostedCodexDeviceLogin"
  ADD COLUMN "targetAccountId" TEXT,
  ADD COLUMN "targetGeneration" BIGINT,
  ADD COLUMN "targetHealthVersion" BIGINT,
  ADD CONSTRAINT "HostedCodexDeviceLogin_reconnect_target_check" CHECK (
    ("targetAccountId" IS NULL AND "targetGeneration" IS NULL AND "targetHealthVersion" IS NULL)
    OR
    ("targetAccountId" IS NOT NULL AND length("targetAccountId") > 0
      AND "targetGeneration" IS NOT NULL AND "targetGeneration" > 0
      AND "targetHealthVersion" IS NOT NULL AND "targetHealthVersion" > 0)
  );
