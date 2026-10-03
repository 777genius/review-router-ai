-- One TEST approval/paid turn/artifact/publication attempt. Preserve its whole
-- normal canonical plan; every distinct SCM operation is consumed at most once.
CREATE TABLE "ExclusiveTestPublicationV2" (
  "executionId" TEXT PRIMARY KEY,
  "publicationIntentId" TEXT NOT NULL UNIQUE,
  "approvalHash" TEXT NOT NULL UNIQUE,
  "intent" JSONB NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "publicationAttemptId" TEXT UNIQUE,
  "binding" JSONB,
  "closedAt" TIMESTAMPTZ(3),
  CONSTRAINT "ExclusiveTestPublicationV2_shape" CHECK (COALESCE((
    jsonb_typeof("intent") = 'object'
    AND "intent"->>'purpose' = 'owner_one_shot_uncapped_test'
    AND "intent"->>'repositoryGitHubId' = '1252762369'
    AND "intent"->>'executionId' = "executionId"
    AND "intent"->>'publicationIntentId' = "publicationIntentId"
    AND "intent"->>'approvalHash' = "approvalHash"
    AND "approvalHash" ~ '^[a-f0-9]{64}$'
    AND ("binding" IS NULL) = ("publicationAttemptId" IS NULL)
    AND ("binding" IS NULL OR (jsonb_typeof("binding") = 'object'
      AND "binding"->'intent' = "intent"
      AND "binding"->>'publicationAttemptId' = "publicationAttemptId"
      AND jsonb_typeof("binding"->'operations') = 'array'
      AND jsonb_array_length("binding"->'operations') > 0))
    AND ("closedAt" IS NULL OR "binding" IS NOT NULL)
  ), false))
);
CREATE TABLE "ExclusiveTestPublicationDispatchV2" (
  "publicationAttemptId" TEXT NOT NULL REFERENCES "ExclusiveTestPublicationV2" ("publicationAttemptId"),
  "publicationOperationId" TEXT NOT NULL,
  "operationAttemptId" TEXT NOT NULL UNIQUE,
  "consumedAt" TIMESTAMPTZ(3) NOT NULL,
  PRIMARY KEY ("publicationAttemptId", "publicationOperationId")
);
CREATE FUNCTION exclusive_test_publication_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_TABLE_NAME = 'ExclusiveTestPublicationDispatchV2' THEN
    RAISE EXCEPTION 'exclusive_publication_immutable';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."binding" IS NOT NULL OR NEW."closedAt" IS NOT NULL OR NEW."expiresAt" <= clock_timestamp() THEN
      RAISE EXCEPTION 'exclusive_publication_initial_state_invalid';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW."executionId", NEW."publicationIntentId", NEW."approvalHash", NEW."intent", NEW."expiresAt")
      IS DISTINCT FROM (OLD."executionId", OLD."publicationIntentId", OLD."approvalHash", OLD."intent", OLD."expiresAt")
      OR OLD."closedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'exclusive_publication_immutable';
  END IF;
  IF OLD."binding" IS NULL THEN
    IF NEW."binding" IS NULL OR NEW."closedAt" IS NOT NULL OR NEW."expiresAt" <= clock_timestamp() THEN
      RAISE EXCEPTION 'exclusive_publication_binding_invalid';
    END IF;
  ELSIF NEW."binding" IS DISTINCT FROM OLD."binding"
      OR NEW."publicationAttemptId" IS DISTINCT FROM OLD."publicationAttemptId"
      OR NEW."closedAt" IS NULL THEN
    RAISE EXCEPTION 'exclusive_publication_close_invalid';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER exclusive_test_publication_immutable_guard
BEFORE INSERT OR UPDATE OR DELETE ON "ExclusiveTestPublicationV2"
FOR EACH ROW EXECUTE FUNCTION exclusive_test_publication_immutable();
CREATE TRIGGER exclusive_test_publication_dispatch_immutable_guard
BEFORE UPDATE OR DELETE ON "ExclusiveTestPublicationDispatchV2"
FOR EACH ROW EXECUTE FUNCTION exclusive_test_publication_immutable();

-- Enforcement is at the DB transition boundary, including OLD worker images.
-- A claim for any other owner is denied before an operation capability exists.
CREATE FUNCTION exclusive_test_publication_transition_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE x "ExclusiveTestPublicationV2"%ROWTYPE; c "ReviewPublicationClaimTermV2"%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'ReviewPublicationAttemptV2' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('exclusive-publication:' || NEW."executionId", 0));
    SELECT * INTO x FROM "ExclusiveTestPublicationV2" WHERE "executionId" = NEW."executionId" FOR UPDATE;
    IF NOT FOUND THEN RETURN NEW; END IF;
    IF x."binding" IS NULL OR x."publicationAttemptId" IS DISTINCT FROM NEW."publicationAttemptId" THEN
      RAISE EXCEPTION 'exclusive_publication_unbound_attempt';
    END IF;
    RETURN NEW;
  END IF;
  -- Same ordering as the repository: attempt row, then admission row.
  PERFORM 1 FROM "ReviewPublicationAttemptV2" WHERE "publicationAttemptId" = NEW."publicationAttemptId" FOR UPDATE;
  SELECT * INTO x FROM "ExclusiveTestPublicationV2" WHERE "publicationAttemptId" = NEW."publicationAttemptId" FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF x."closedAt" IS NOT NULL THEN RAISE EXCEPTION 'exclusive_publication_closed'; END IF;
  IF TG_TABLE_NAME = 'ReviewPublicationClaimTermV2' THEN
    IF NEW."ownerIdHash" IS DISTINCT FROM x."intent"->>'ownerIdHash' THEN
      RAISE EXCEPTION 'exclusive_publication_owner_denied';
    END IF;
  ELSE
    SELECT * INTO c FROM "ReviewPublicationClaimTermV2" WHERE "claimId" = NEW."claimId";
    IF NOT FOUND OR c."ownerIdHash" IS DISTINCT FROM x."intent"->>'ownerIdHash'
      OR c."publicationAttemptId" IS DISTINCT FROM NEW."publicationAttemptId"
      OR c."fencingToken" IS DISTINCT FROM NEW."claimFencingToken"
      OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(x."binding"->'operations') op
        WHERE op->>'publicationOperationId' = NEW."publicationOperationId") THEN
      RAISE EXCEPTION 'exclusive_publication_operation_denied';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER exclusive_test_publication_attempt_guard BEFORE INSERT ON "ReviewPublicationAttemptV2"
FOR EACH ROW EXECUTE FUNCTION exclusive_test_publication_transition_guard();
CREATE TRIGGER exclusive_test_publication_claim_guard BEFORE INSERT OR UPDATE ON "ReviewPublicationClaimTermV2"
FOR EACH ROW EXECUTE FUNCTION exclusive_test_publication_transition_guard();
CREATE TRIGGER exclusive_test_publication_begin_guard BEFORE INSERT OR UPDATE ON "ReviewPublicationOperationAttemptV2"
FOR EACH ROW EXECUTE FUNCTION exclusive_test_publication_transition_guard();

CREATE FUNCTION exclusive_test_publication_dispatch_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE x "ExclusiveTestPublicationV2"%ROWTYPE; selected_ordinal bigint;
BEGIN
  PERFORM 1 FROM "ReviewPublicationAttemptV2" WHERE "publicationAttemptId" = NEW."publicationAttemptId" FOR UPDATE;
  SELECT * INTO x FROM "ExclusiveTestPublicationV2" WHERE "publicationAttemptId" = NEW."publicationAttemptId" FOR UPDATE;
  IF NOT FOUND OR x."closedAt" IS NOT NULL OR x."expiresAt" <= clock_timestamp() THEN
    RAISE EXCEPTION 'exclusive_publication_dispatch_closed';
  END IF;
  SELECT ordinal INTO selected_ordinal FROM jsonb_array_elements(x."binding"->'operations') WITH ORDINALITY AS p(op, ordinal)
    WHERE op->>'publicationOperationId' = NEW."publicationOperationId";
  IF selected_ordinal IS NULL OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(x."binding"->'operations') WITH ORDINALITY AS p(op, ordinal)
    WHERE ordinal < selected_ordinal AND NOT EXISTS (
      SELECT 1 FROM "ReviewPublicationReceiptV2" r WHERE r."publicationAttemptId" = NEW."publicationAttemptId"
        AND r."publicationOperationId" = op->>'publicationOperationId' AND r."status" = 'succeeded'
    )
  ) OR NOT EXISTS (
    SELECT 1 FROM "ReviewPublicationOperationAttemptV2" o
    JOIN "ReviewPublicationClaimTermV2" c ON c."claimId" = o."claimId"
    JOIN "ReviewPublicationAttemptV2" a ON a."publicationAttemptId" = o."publicationAttemptId"
    WHERE o."operationAttemptId" = NEW."operationAttemptId" AND o."publicationAttemptId" = NEW."publicationAttemptId"
      AND o."publicationOperationId" = NEW."publicationOperationId" AND o."state" = 'active' AND o."effectReportUntil" > clock_timestamp()
      AND c."ownerIdHash" = x."intent"->>'ownerIdHash' AND c."state" = 'active' AND c."expiresAt" > clock_timestamp()
      AND c."fencingToken" = o."claimFencingToken" AND a."activeClaimId" = c."claimId" AND a."state" <> 'terminal'
  ) THEN RAISE EXCEPTION 'exclusive_publication_dispatch_denied'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER exclusive_test_publication_dispatch_guard BEFORE INSERT ON "ExclusiveTestPublicationDispatchV2"
FOR EACH ROW EXECUTE FUNCTION exclusive_test_publication_dispatch_guard();
