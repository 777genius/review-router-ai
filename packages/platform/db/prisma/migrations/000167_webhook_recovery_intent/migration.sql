-- Draft-only: this schema does not authorize replay or automatic redelivery.
CREATE TABLE "GitHubWebhookRecoveryIntent" (
  "appIdentityHash" TEXT NOT NULL,
  "deliveryGuid" TEXT NOT NULL,
  "githubDeliveryId" BIGINT NOT NULL,
  "eventName" TEXT NOT NULL,
  "action" TEXT,
  "installationId" BIGINT,
  "payloadHash" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'prepared',
  "attemptHash" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "GitHubWebhookRecoveryIntent_pkey" PRIMARY KEY ("appIdentityHash", "deliveryGuid"),
  CONSTRAINT "GitHubWebhookRecoveryIntent_app_hash" CHECK ("appIdentityHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "GitHubWebhookRecoveryIntent_payload_hash" CHECK ("payloadHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "GitHubWebhookRecoveryIntent_guid" CHECK (length("deliveryGuid") BETWEEN 1 AND 200),
  CONSTRAINT "GitHubWebhookRecoveryIntent_event" CHECK (length("eventName") BETWEEN 1 AND 100),
  CONSTRAINT "GitHubWebhookRecoveryIntent_id" CHECK ("githubDeliveryId" > 0),
  CONSTRAINT "GitHubWebhookRecoveryIntent_installation" CHECK ("installationId" IS NULL OR "installationId" > 0),
  CONSTRAINT "GitHubWebhookRecoveryIntent_attempt_hash" CHECK (
    ("state" = 'prepared' AND "attemptHash" IS NULL) OR
    ("state" IN ('issued_unknown', 'accepted') AND "attemptHash" IS NOT NULL AND "attemptHash" ~ '^[0-9a-f]{64}$') OR
    ("state" = 'confirmed' AND ("attemptHash" IS NULL OR "attemptHash" ~ '^[0-9a-f]{64}$'))
  ),
  CONSTRAINT "GitHubWebhookRecoveryIntent_state" CHECK ("state" IN ('prepared','issued_unknown','accepted','confirmed'))
);
