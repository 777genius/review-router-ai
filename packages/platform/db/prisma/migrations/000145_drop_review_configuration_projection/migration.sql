-- Stored policy schema 4 keeps the provider selections in policyJson only.
-- Since then nothing writes or reads the schema 1-3 projection of the first
-- provider or the ordered provider rows, so both go. The CHECKs of the
-- projection go with it; the Gateway references that stay keep their pairing,
-- format and secret-prefix guard. Existing versions keep their policyJson.
ALTER TABLE "ReviewConfigurationVersion"
  DROP CONSTRAINT "ReviewConfigurationVersion_auth_kind",
  DROP CONSTRAINT "ReviewConfigurationVersion_gateway_selection",
  DROP COLUMN "providerKind",
  DROP COLUMN "providerAuthMode",
  DROP COLUMN "model",
  DROP COLUMN "reasoningEffort",
  DROP COLUMN "failOnSeverity",
  DROP COLUMN "inlineMaxComments",
  DROP COLUMN "targetTokensPerBatch",
  ADD CONSTRAINT "ReviewConfigurationVersion_gateway_reference" CHECK (
    ("gatewayBindingId" IS NULL AND "gatewayProfileRef" IS NULL) OR (
      "gatewayBindingId" IS NOT NULL AND "gatewayProfileRef" IS NOT NULL AND
      "gatewayBindingId" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$' AND
      "gatewayProfileRef" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$' AND
      "gatewayBindingId" !~ '^(sk-|ghp_|github_pat_|xox[baprs]-)' AND
      "gatewayProfileRef" !~ '^(sk-|ghp_|github_pat_|xox[baprs]-)'
    )
  );

DROP TABLE "ReviewConfigurationVersionProvider";
