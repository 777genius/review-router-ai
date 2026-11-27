BEGIN;
ALTER TABLE "ReviewRunCompanionDispatchV1"
  ADD COLUMN "nativeRetryProofJson" JSONB,
  ADD COLUMN "retryOfDispatchId" TEXT;
CREATE UNIQUE INDEX "ReviewRunModelDispatch_retry_predecessor_key"
  ON "ReviewRunCompanionDispatchV1" ("authorizationId", "retryOfDispatchId");
ALTER TABLE "ReviewRunCompanionDispatchV1"
  ADD CONSTRAINT "ReviewRunModelDispatch_native_retry_scope_check" CHECK (
    ("nativeRetryProofJson" IS NULL AND "retryOfDispatchId" IS NULL) OR
    ("dispatchVersion" = 2 AND "role" = 'finding_discovery' AND
      ("nativeRetryProofJson" IS NULL OR
        ("retryOfDispatchId" IS NULL AND "forwardedAt" IS NOT NULL AND
         "state" = 'not_dispatched' AND "nativeEffectState" IS NOT NULL AND
         "nativeEffectState" = 'not_dispatched')) AND
      ("retryOfDispatchId" IS NULL OR
        ("retryOfDispatchId" <> "dispatchId" AND
         "retryOfDispatchId" ~ '^rr-model-[a-f0-9]{64}$')))
  );
COMMIT;
