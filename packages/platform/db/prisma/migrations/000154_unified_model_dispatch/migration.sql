BEGIN;
-- Historical approvals and reservations keep their exact V1 interpretation.
ALTER TABLE "ProducerRelease" ADD COLUMN "modelDispatchProfile" JSONB;
ALTER TABLE "ReviewRunCompanionDispatchV1"
  ADD COLUMN "dispatchVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "requestOrdinal" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "routeIdentityHash" TEXT,
  ADD COLUMN "requestBytes" INTEGER,
  ADD COLUMN "maxOutputTokens" INTEGER,
  ADD COLUMN "terminalReceiptJson" JSONB,
  ADD COLUMN "receiptTokenHash" TEXT,
  ADD COLUMN "forwardedAt" TIMESTAMP(3),
  ADD COLUMN "nativeEffectState" TEXT;

DROP INDEX "ReviewRunCompanionDispatchV1_authorizationId_workSlotId_att_key";
CREATE UNIQUE INDEX "ReviewRunModelDispatch_scope_ordinal_key"
  ON "ReviewRunCompanionDispatchV1" ("authorizationId", "workSlotId", "attemptOrdinal", "requestOrdinal");
CREATE UNIQUE INDEX "ReviewRunModelDispatch_receipt_token_key"
  ON "ReviewRunCompanionDispatchV1" ("receiptTokenHash");
ALTER TABLE "ReviewRunCompanionDispatchV1"
  DROP CONSTRAINT "ReviewRunCompanionDispatchV1_role_check",
  ADD CONSTRAINT "ReviewRunModelDispatch_version_check" CHECK ("dispatchVersion" IN (1, 2)),
  ADD CONSTRAINT "ReviewRunModelDispatch_ordinal_check" CHECK ("requestOrdinal" >= 1 AND ("dispatchVersion" = 2 OR "requestOrdinal" = 1)),
  ADD CONSTRAINT "ReviewRunModelDispatch_role_check" CHECK (
    "role" IN ('lifecycle_verification', 'pr_description') OR
    ("dispatchVersion" = 2 AND "role" = 'finding_discovery')
  ),
  ADD CONSTRAINT "ReviewRunModelDispatch_v2_metadata_check" CHECK (
    "dispatchVersion" = 1 OR (
      "routeIdentityHash" IS NOT NULL AND "routeIdentityHash" ~ '^[a-f0-9]{64}$' AND
      "receiptTokenHash" IS NOT NULL AND "receiptTokenHash" ~ '^[a-f0-9]{64}$' AND
      "requestBytes" IS NOT NULL AND "requestBytes" > 0 AND "requestBytes" <= 16777216 AND
      "maxOutputTokens" IS NOT NULL AND "maxOutputTokens" > 0 AND "maxOutputTokens" <= 32768
    )
  ),
  ADD CONSTRAINT "ReviewRunModelDispatch_terminal_receipt_check" CHECK (
    "dispatchVersion" = 1 OR "state" <> 'completed' OR "terminalReceiptJson" IS NOT NULL
  ),
  ADD CONSTRAINT "ReviewRunModelDispatch_native_effect_check" CHECK (
    "nativeEffectState" IS NULL OR "nativeEffectState" IN ('completed', 'not_dispatched', 'effect_unknown')
  );
COMMIT;
