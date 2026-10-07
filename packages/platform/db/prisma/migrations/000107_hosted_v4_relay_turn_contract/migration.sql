BEGIN;

CREATE TABLE "HostedCodexV4RelayTurn" (
  "logicalTurnKey" TEXT PRIMARY KEY,
  "scopeHash" TEXT NOT NULL,
  "scopeCanonical" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "maxRequests" INTEGER NOT NULL,
  "maxRequestBytes" INTEGER NOT NULL,
  "maxResponseBytes" INTEGER NOT NULL,
  "maxOutputTokens" INTEGER NOT NULL,
  "authorizationId" TEXT NOT NULL,
  "investigationId" TEXT NOT NULL,
  "turnId" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'open',
  "unknownAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HostedCodexV4RelayTurn_state_check"
    CHECK (("state" = 'open' AND "unknownAt" IS NULL) OR
           ("state" = 'terminal_unknown' AND "unknownAt" IS NOT NULL)),
  CONSTRAINT "HostedCodexV4RelayTurn_hash_check"
    CHECK ("logicalTurnKey" ~ '^[a-f0-9]{64}$' AND "scopeHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "HostedCodexV4RelayTurn_budget_check"
    CHECK ("maxRequests" > 0 AND "maxRequestBytes" > 0 AND
           "maxResponseBytes" > 0 AND "maxOutputTokens" > 0)
);
CREATE UNIQUE INDEX "HostedCodexV4RelayTurn_scope_key"
  ON "HostedCodexV4RelayTurn" ("investigationId", "turnId");
CREATE INDEX "HostedCodexV4RelayTurn_state_unknown_idx"
  ON "HostedCodexV4RelayTurn" ("state", "unknownAt");

ALTER TABLE "HostedCodexInvocationGrant"
  ADD COLUMN "authorityKind" TEXT NOT NULL DEFAULT 'v1_comment',
  ADD COLUMN "v4TurnKey" TEXT,
  ADD COLUMN "v4ScopeHash" TEXT,
  ADD CONSTRAINT "HostedCodexInvocationGrant_authority_kind_check"
    CHECK (("authorityKind" = 'v1_comment' AND "v4TurnKey" IS NULL AND "v4ScopeHash" IS NULL) OR
           ("authorityKind" = 'v4_relay_turn' AND "v4TurnKey" IS NOT NULL AND "v4ScopeHash" IS NOT NULL));
CREATE UNIQUE INDEX "HostedCodexInvocationGrant_v4TurnKey_key"
  ON "HostedCodexInvocationGrant" ("v4TurnKey");
ALTER TABLE "HostedCodexInvocationGrant"
  ADD CONSTRAINT "HostedCodexInvocationGrant_v4TurnKey_fkey"
  FOREIGN KEY ("v4TurnKey") REFERENCES "HostedCodexV4RelayTurn"("logicalTurnKey")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "HostedCodexRelayRequest"
  ADD COLUMN "authorityKind" TEXT NOT NULL DEFAULT 'v1_comment',
  ADD CONSTRAINT "HostedCodexRelayRequest_authority_kind_check"
    CHECK ("authorityKind" = 'v1_comment' OR
           ("authorityKind" = 'v4_relay_turn' AND "requestHash" IS NOT NULL
            AND "requestHash" ~ '^[a-f0-9]{64}$'
            AND "ordinal" > 0));
ALTER TABLE "HostedCodexUpstreamEffectAttempt"
  ADD COLUMN "authorityKind" TEXT NOT NULL DEFAULT 'v1_comment',
  ADD CONSTRAINT "HostedCodexUpstreamEffectAttempt_authority_kind_check"
    CHECK ("authorityKind" = 'v1_comment' OR
           ("authorityKind" = 'v4_relay_turn' AND "requestHash" IS NOT NULL
            AND "requestHash" ~ '^[a-f0-9]{64}$'
            AND "credentialGeneration" IS NOT NULL AND "fenceEpoch" > 0));

CREATE FUNCTION hosted_codex_v4_turn_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $guard$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."logicalTurnKey" IS DISTINCT FROM OLD."logicalTurnKey" OR
       NEW."scopeHash" IS DISTINCT FROM OLD."scopeHash" OR
       NEW."scopeCanonical" IS DISTINCT FROM OLD."scopeCanonical" OR
       NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt" OR
       NEW."maxRequests" IS DISTINCT FROM OLD."maxRequests" OR
       NEW."maxRequestBytes" IS DISTINCT FROM OLD."maxRequestBytes" OR
       NEW."maxResponseBytes" IS DISTINCT FROM OLD."maxResponseBytes" OR
       NEW."maxOutputTokens" IS DISTINCT FROM OLD."maxOutputTokens" OR
       NEW."authorizationId" IS DISTINCT FROM OLD."authorizationId" OR
       NEW."investigationId" IS DISTINCT FROM OLD."investigationId" OR
       NEW."turnId" IS DISTINCT FROM OLD."turnId" OR
       NEW."createdAt" IS DISTINCT FROM OLD."createdAt" OR
       OLD."state" = 'terminal_unknown' AND NEW."state" <> 'terminal_unknown' OR
       OLD."unknownAt" IS NOT NULL AND NEW."unknownAt" IS DISTINCT FROM OLD."unknownAt" THEN
      RAISE EXCEPTION 'hosted_v4_relay_turn_immutable';
    END IF;
  END IF;
  RETURN NEW;
END $guard$;
CREATE TRIGGER hosted_codex_v4_turn_guard_trigger
  BEFORE UPDATE ON "HostedCodexV4RelayTurn"
  FOR EACH ROW EXECUTE FUNCTION hosted_codex_v4_turn_guard();

CREATE FUNCTION hosted_codex_v4_grant_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $guard$
DECLARE turn_record public."HostedCodexV4RelayTurn"%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' AND (
       NEW."authorityKind" IS DISTINCT FROM OLD."authorityKind" OR
       NEW."v4TurnKey" IS DISTINCT FROM OLD."v4TurnKey" OR
       NEW."v4ScopeHash" IS DISTINCT FROM OLD."v4ScopeHash") THEN
    RAISE EXCEPTION 'hosted_v4_relay_grant_scope_immutable';
  END IF;
  IF NEW."authorityKind" = 'v4_relay_turn' THEN
    SELECT * INTO turn_record FROM public."HostedCodexV4RelayTurn"
      WHERE "logicalTurnKey" = NEW."v4TurnKey" FOR UPDATE;
    IF NOT FOUND OR (TG_OP = 'INSERT' AND turn_record."state" <> 'open') OR
       turn_record."scopeHash" IS DISTINCT FROM NEW."v4ScopeHash" OR
       turn_record."expiresAt" IS DISTINCT FROM NEW."expiresAt" OR
       turn_record."maxRequests" IS DISTINCT FROM NEW."maxRequests" OR
       turn_record."maxRequestBytes" IS DISTINCT FROM NEW."maxRequestBytes" OR
       turn_record."maxResponseBytes" IS DISTINCT FROM NEW."maxResponseBytes" OR
       turn_record."maxOutputTokens" IS DISTINCT FROM NEW."maxOutputTokens" OR
       NEW."maxConcurrentRequests" <> 1 THEN
      RAISE EXCEPTION 'hosted_v4_relay_grant_turn_denied';
    END IF;
  END IF;
  RETURN NEW;
END $guard$;
CREATE TRIGGER hosted_codex_v4_grant_guard_trigger
  BEFORE INSERT OR UPDATE ON "HostedCodexInvocationGrant"
  FOR EACH ROW EXECUTE FUNCTION hosted_codex_v4_grant_guard();

CREATE FUNCTION hosted_codex_v4_comment_separation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public."HostedCodexInvocationGrant"
             WHERE "id" = NEW."grantId" AND "authorityKind" = 'v4_relay_turn') THEN
    RAISE EXCEPTION 'hosted_v4_relay_comment_capability_forbidden';
  END IF;
  RETURN NEW;
END $guard$;
CREATE TRIGGER hosted_codex_v4_comment_separation_trigger
  BEFORE INSERT OR UPDATE ON "HostedCodexCommentRefreshCapability"
  FOR EACH ROW EXECUTE FUNCTION hosted_codex_v4_comment_separation();

-- PR1 has no verified relay-turn lease policy or dispatch composition. The DB
-- enforces the default-off boundary even if an old v1 adapter sees a v4 grant.
CREATE FUNCTION hosted_codex_v4_dispatch_disabled()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $guard$
DECLARE grant_kind TEXT;
BEGIN
  SELECT "authorityKind" INTO grant_kind FROM public."HostedCodexInvocationGrant"
    WHERE "id" = NEW."grantId";
  IF grant_kind IS NULL OR NEW."authorityKind" IS DISTINCT FROM grant_kind OR
     grant_kind = 'v4_relay_turn' THEN
    RAISE EXCEPTION 'hosted_v4_relay_dispatch_disabled';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."authorityKind" IS DISTINCT FROM OLD."authorityKind" THEN
    RAISE EXCEPTION 'hosted_relay_request_authority_immutable';
  END IF;
  RETURN NEW;
END $guard$;
CREATE TRIGGER hosted_codex_v4_request_dispatch_guard_trigger
  BEFORE INSERT OR UPDATE ON "HostedCodexRelayRequest"
  FOR EACH ROW EXECUTE FUNCTION hosted_codex_v4_dispatch_disabled();
CREATE TRIGGER hosted_codex_v4_effect_dispatch_guard_trigger
  BEFORE INSERT OR UPDATE ON "HostedCodexUpstreamEffectAttempt"
  FOR EACH ROW EXECUTE FUNCTION hosted_codex_v4_dispatch_disabled();

-- When PR2 supplies a verified dispatch gate, the unknown-effect tombstone
-- remains monotonic and is written by the same transaction as the effect.
CREATE FUNCTION hosted_codex_v4_unknown_effect_fence()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fence$
DECLARE turn_key TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD."state" = 'terminal_unknown' THEN RETURN NEW; END IF;
  END IF;
  IF NEW."authorityKind" = 'v4_relay_turn' AND
     NEW."state" = 'terminal_unknown' THEN
    SELECT "v4TurnKey" INTO turn_key FROM public."HostedCodexInvocationGrant"
      WHERE "id" = NEW."grantId";
    IF turn_key IS NULL THEN
      RAISE EXCEPTION 'hosted_v4_relay_turn_missing';
    END IF;
    UPDATE public."HostedCodexV4RelayTurn"
      SET "state" = 'terminal_unknown',
          "unknownAt" = COALESCE(NEW."completedAt", CURRENT_TIMESTAMP),
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "logicalTurnKey" = turn_key AND "state" = 'open';
    UPDATE public."HostedCodexInvocationGrant"
      SET "status" = 'revoked',
          "revokedAt" = COALESCE(NEW."completedAt", CURRENT_TIMESTAMP),
          "revision" = "revision" + 1
      WHERE "v4TurnKey" = turn_key AND "status" IN ('issued', 'exhausted');
  END IF;
  RETURN NEW;
END $fence$;
CREATE TRIGGER hosted_codex_v4_unknown_effect_fence_trigger
  AFTER INSERT OR UPDATE OF "state" ON "HostedCodexUpstreamEffectAttempt"
  FOR EACH ROW EXECUTE FUNCTION hosted_codex_v4_unknown_effect_fence();

COMMIT;
