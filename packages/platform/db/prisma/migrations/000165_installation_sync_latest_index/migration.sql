CREATE INDEX CONCURRENTLY "OutboxEvent_installation_sync_latest_idx"
ON "OutboxEvent" ("aggregateId", "createdAt" DESC, "id" DESC)
WHERE "type" = 'installation.sync_requested' AND "version" = 1;
