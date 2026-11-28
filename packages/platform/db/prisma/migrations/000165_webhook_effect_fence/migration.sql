-- Additive only: no existing/legacy delivery receives a fence or a takeover.
CREATE TABLE "GitHubWebhookFence" (
    "deliveryId" TEXT NOT NULL,
    "ownerHash" TEXT NOT NULL,
    "appIdentityHash" TEXT NOT NULL,
    "generation" BIGINT NOT NULL,
    "leaseUntil" TIMESTAMPTZ(3) NOT NULL,
    "effectTransactionId" BIGINT,
    "signatureHash" TEXT,
    CONSTRAINT "GitHubWebhookFence_pkey" PRIMARY KEY ("deliveryId"),
    CONSTRAINT "GitHubWebhookFence_generation_check" CHECK ("generation" > 0),
    CONSTRAINT "GitHubWebhookFence_app_identity_check" CHECK ("appIdentityHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "GitHubWebhookFence_signature_check" CHECK ("signatureHash" IS NULL OR "signatureHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "GitHubWebhookFence_owner_check" CHECK ("ownerHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "GitHubWebhookFence_delivery_fkey" FOREIGN KEY ("deliveryId")
      REFERENCES "GitHubWebhookDelivery"("deliveryId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Only the transaction that verified the owner may change a fenced receipt.
-- This protects new receipts from old terminal writers; legacy effects still
-- require an exact-version deployment and drain before production adoption.
CREATE FUNCTION "guardGitHubWebhookDeliveryFence"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  fenced BOOLEAN;
  effect_transaction BIGINT;
  lease_until TIMESTAMPTZ;
BEGIN
  EXECUTE format(
    'SELECT TRUE, "effectTransactionId", "leaseUntil" FROM %I."GitHubWebhookFence" WHERE "deliveryId" = $1',
    TG_TABLE_SCHEMA
  ) INTO fenced, effect_transaction, lease_until USING OLD."deliveryId";
  IF fenced IS DISTINCT FROM TRUE THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'webhook_fence_receipt_retained' USING ERRCODE = '23514';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW."deliveryId" IS DISTINCT FROM OLD."deliveryId"
      OR NEW."eventName" IS DISTINCT FROM OLD."eventName"
      OR NEW.action IS DISTINCT FROM OLD.action
      OR NEW."installationId" IS DISTINCT FROM OLD."installationId"
      OR NEW."payloadHash" IS DISTINCT FROM OLD."payloadHash"
      OR NEW."normalizedEvent" IS DISTINCT FROM OLD."normalizedEvent"
      OR NEW."receivedAt" IS DISTINCT FROM OLD."receivedAt" THEN
    RAISE EXCEPTION 'webhook_fence_identity_immutable' USING ERRCODE = '23514';
  END IF;
  IF effect_transaction IS DISTINCT FROM txid_current()
      OR NOT (
        (OLD.status::text = 'processing' AND NEW.status::text IN ('processing', 'processed', 'failed'))
        OR (OLD.status::text = 'failed' AND NEW.status::text = 'processing')
      )
      OR (NEW.status::text <> 'failed' AND lease_until <= clock_timestamp()) THEN
    RAISE EXCEPTION 'webhook_fence_transaction_required' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "GitHubWebhookDelivery_fence_guard"
BEFORE UPDATE OR DELETE ON "GitHubWebhookDelivery"
FOR EACH ROW EXECUTE FUNCTION "guardGitHubWebhookDeliveryFence"();
