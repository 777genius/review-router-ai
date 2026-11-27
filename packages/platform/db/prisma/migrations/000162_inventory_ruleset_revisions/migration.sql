-- Fence complete inventory application, including repositories not yet stored.
ALTER TABLE "GitHubInstallation"
  ADD COLUMN "inventoryGeneration" BIGINT NOT NULL DEFAULT 0;

-- New requests advance desired state independently of wall-clock precision.
ALTER TABLE "OrgRulesetProvisioning"
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
