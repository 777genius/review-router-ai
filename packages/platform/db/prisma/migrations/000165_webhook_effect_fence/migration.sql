-- Additive only: no existing/legacy delivery receives a fence or a takeover.
CREATE TABLE "GitHubWebhookFence" (
    "deliveryId" TEXT NOT NULL,
    "ownerHash" TEXT NOT NULL,
    "appIdentityHash" TEXT NOT NULL,
    "generation" BIGINT NOT NULL,
    "leaseUntil" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "GitHubWebhookFence_pkey" PRIMARY KEY ("deliveryId"),
    CONSTRAINT "GitHubWebhookFence_generation_check" CHECK ("generation" > 0),
    CONSTRAINT "GitHubWebhookFence_app_identity_check" CHECK ("appIdentityHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "GitHubWebhookFence_owner_check" CHECK ("ownerHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "GitHubWebhookFence_delivery_fkey" FOREIGN KEY ("deliveryId")
      REFERENCES "GitHubWebhookDelivery"("deliveryId") ON DELETE CASCADE ON UPDATE CASCADE
);
