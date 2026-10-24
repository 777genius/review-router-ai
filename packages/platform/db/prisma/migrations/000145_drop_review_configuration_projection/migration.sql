-- Stored policy schema 4 keeps the provider selections in policyJson only.
-- Since then nothing writes or reads the schema 1-3 projection of the first
-- provider or the ordered provider rows, so both go. The CHECKs of the
-- projection go with it; existing versions keep their policyJson.
ALTER TABLE "ReviewConfigurationVersion"
  DROP CONSTRAINT "ReviewConfigurationVersion_auth_kind",
  DROP CONSTRAINT "ReviewConfigurationVersion_gateway_selection",
  DROP COLUMN "providerKind",
  DROP COLUMN "providerAuthMode",
  DROP COLUMN "model",
  DROP COLUMN "reasoningEffort",
  DROP COLUMN "failOnSeverity",
  DROP COLUMN "inlineMaxComments",
  DROP COLUMN "targetTokensPerBatch";

DROP TABLE "ReviewConfigurationVersionProvider";
