-- Additive only. Presence of this table does not authorize fenced takeover.
CREATE TABLE "CurrentScopeEpoch" (
  "keyHash" TEXT NOT NULL,
  "revision" BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT "CurrentScopeEpoch_pkey" PRIMARY KEY ("keyHash"),
  CONSTRAINT "CurrentScopeEpoch_hash_check" CHECK ("keyHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "CurrentScopeEpoch_revision_check" CHECK ("revision" >= 0)
);
