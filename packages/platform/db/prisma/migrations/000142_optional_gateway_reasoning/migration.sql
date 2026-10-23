-- Qualified Gateway models can omit reasoning. Preserve every existing value.
ALTER TABLE "ReviewConfigurationVersion" ALTER COLUMN "reasoningEffort" DROP NOT NULL;
ALTER TABLE "ReviewConfigurationVersionProvider" ALTER COLUMN "reasoningEffort" DROP NOT NULL;
