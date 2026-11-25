ALTER TABLE "OrgRulesetProvisioning"
  ADD COLUMN "pendingRulesetCreateOrganization" TEXT,
  ADD COLUMN "pendingRemoteAttemptId" TEXT;

CREATE INDEX "OrgRulesetProvisioning_organization_identity_idx"
  ON "OrgRulesetProvisioning" (lower("organizationLogin"));
