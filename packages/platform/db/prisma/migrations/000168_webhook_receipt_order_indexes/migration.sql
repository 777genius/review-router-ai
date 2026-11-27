-- Additive receipt-order indexes for the existing guarded admission lookup.
-- Apply during the required webhook writer drain; retained rows are unchanged.
CREATE INDEX "GitHubWebhookDelivery_installation_receipt_order_idx"
ON "GitHubWebhookDelivery" ("installationId", "receivedAt" DESC)
WHERE "eventName" IN ('installation', 'installation_repositories', 'repository');

CREATE INDEX "GitHubWebhookDelivery_repository_receipt_order_idx"
ON "GitHubWebhookDelivery" (("normalizedEvent" ->> 'repositoryId'), "receivedAt" DESC)
WHERE "eventName" = 'repository';
