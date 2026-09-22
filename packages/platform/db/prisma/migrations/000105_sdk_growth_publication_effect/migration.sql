-- Lane B durable publication protocol. Lane A was never production-composed,
-- so an old-shaped effect cannot be upgraded without inventing its App/repo
-- identity. Refuse that impossible migration instead of publishing ambiguity.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "SdkGrowthPublicationEffect") THEN
    RAISE EXCEPTION 'SDK growth legacy publication effects require operator reconciliation';
  END IF;
END;
$$;

DROP TRIGGER sdk_growth_publication_immutable ON "SdkGrowthPublicationEffect";
DROP TRIGGER sdk_growth_publication_no_truncate ON "SdkGrowthPublicationEffect";
DROP FUNCTION sdk_growth_publication_preserve();

ALTER TABLE "SdkGrowthPublicationEffect"
  DROP CONSTRAINT "SdkGrowthPublicationEffect_state_check",
  ADD COLUMN "envelopeDigest" VARCHAR(64) NOT NULL,
  ADD COLUMN "intent" JSONB NOT NULL,
  ADD COLUMN "attemptStartedAt" TIMESTAMPTZ(3),
  ADD COLUMN "reconciliationCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastEvidence" JSONB,
  ADD COLUMN "outboxEventId" TEXT,
  ADD COLUMN "completedAt" TIMESTAMPTZ(3),
  DROP COLUMN "providerCorrelation",
  ADD CONSTRAINT "SdkGrowthPublicationEffect_envelope_digest_check"
    CHECK ("envelopeDigest" ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT "SdkGrowthPublicationEffect_intent_check"
    CHECK (jsonb_typeof("intent") = 'object' AND octet_length("intent"::text) BETWEEN 2 AND 32768),
  ADD CONSTRAINT "SdkGrowthPublicationEffect_state_check"
    CHECK ("state" IN ('ready', 'sending', 'reconcile-required', 'superseded', 'not-applied', 'applied', 'recovery-required')),
  ADD CONSTRAINT "SdkGrowthPublicationEffect_reconciliation_count_check"
    CHECK ("reconciliationCount" BETWEEN 0 AND 20),
  ADD CONSTRAINT "SdkGrowthPublicationEffect_shape_check" CHECK (
    ("state" = 'ready' AND "attemptId" IS NULL AND "attemptStartedAt" IS NULL AND
      "reconciliationCount" = 0 AND "lastEvidence" IS NULL AND "completedAt" IS NULL)
    OR
    ("state" = 'sending' AND "attemptId" IS NOT NULL AND "attemptStartedAt" IS NOT NULL AND
      "reconciliationCount" = 0 AND "lastEvidence" IS NULL AND "completedAt" IS NULL)
    OR
    ("state" = 'reconcile-required' AND "attemptId" IS NOT NULL AND "attemptStartedAt" IS NOT NULL AND
      "reconciliationCount" BETWEEN 1 AND 19 AND "lastEvidence" IS NOT NULL AND "completedAt" IS NULL)
    OR
    ("state" = 'superseded' AND "attemptId" IS NULL AND "attemptStartedAt" IS NULL AND
      "reconciliationCount" = 0 AND "lastEvidence" IS NOT NULL AND "completedAt" IS NOT NULL)
    OR
    ("state" IN ('not-applied', 'applied', 'recovery-required') AND
      "attemptId" IS NOT NULL AND "attemptStartedAt" IS NOT NULL AND
      "lastEvidence" IS NOT NULL AND "completedAt" IS NOT NULL)
  );

CREATE UNIQUE INDEX "SdkGrowthPublicationEffect_outbox_event_key"
  ON "SdkGrowthPublicationEffect" ("outboxEventId");

CREATE FUNCTION sdk_growth_publication_preserve() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'SDK growth publication effects cannot be deleted';
  END IF;
  IF ROW(NEW."custodyId", NEW."intentId", NEW."envelopeDigest", NEW."intent", NEW."createdAt")
     IS DISTINCT FROM
     ROW(OLD."custodyId", OLD."intentId", OLD."envelopeDigest", OLD."intent", OLD."createdAt")
     OR NEW."claimVersion" < OLD."claimVersion"
     OR (OLD."outboxEventId" IS NOT NULL AND NEW."outboxEventId" IS DISTINCT FROM OLD."outboxEventId")
     OR (OLD."attemptId" IS NOT NULL AND NEW."attemptId" IS DISTINCT FROM OLD."attemptId")
     OR NEW."reconciliationCount" < OLD."reconciliationCount"
     OR (OLD."completedAt" IS NOT NULL AND ROW(NEW."state", NEW."lastEvidence", NEW."completedAt")
       IS DISTINCT FROM ROW(OLD."state", OLD."lastEvidence", OLD."completedAt")) THEN
    RAISE EXCEPTION 'SDK growth publication identity or terminal evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sdk_growth_publication_immutable
  BEFORE UPDATE OR DELETE ON "SdkGrowthPublicationEffect"
  FOR EACH ROW EXECUTE FUNCTION sdk_growth_publication_preserve();
CREATE TRIGGER sdk_growth_publication_no_truncate
  BEFORE TRUNCATE ON "SdkGrowthPublicationEffect"
  FOR EACH STATEMENT EXECUTE FUNCTION sdk_growth_publication_preserve();
