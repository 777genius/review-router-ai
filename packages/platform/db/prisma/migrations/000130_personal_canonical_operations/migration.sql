-- Disabled H C4 canonical coordination. No credential payload or runtime activation.
-- Distinct original epoch; metadata revisions never stand in for auth authority.
BEGIN;
ALTER TABLE "PersonalAccountOperation" ADD COLUMN "expectedAuthorizationEpoch" BIGINT;
ALTER TABLE "PersonalAccountOperation" DROP CONSTRAINT "PersonalAccountOperation_action_check";
ALTER TABLE "PersonalAccountOperation" ADD CONSTRAINT "PersonalAccountOperation_action_check"
  CHECK ("action" IN ('connect','rename','reconnect','retire','attach','revoke'));
ALTER TABLE "PersonalAccountOperation" DROP CONSTRAINT "PersonalAccountOperation_phase_check";
ALTER TABLE "PersonalAccountOperation" ADD CONSTRAINT "PersonalAccountOperation_phase_check"
  CHECK ("phase" IN ('reserved','fencing','ready','submitted','unknown','rejected','applied'));
ALTER TABLE "PersonalAccountOperation" ADD CONSTRAINT "PersonalAccountOperation_epoch_shape" CHECK (
  ("action" IN ('rename','reconnect','retire') AND "expectedAuthorizationEpoch" IS NOT NULL
    AND "expectedAuthorizationEpoch" BETWEEN 1 AND 9007199254740991)
  OR ("action" NOT IN ('rename','reconnect','retire') AND "expectedAuthorizationEpoch" IS NULL));
ALTER TABLE "PersonalAccountOperation" DROP CONSTRAINT "PersonalAccountOperation_intent_shape";
ALTER TABLE "PersonalAccountOperation" ADD CONSTRAINT "PersonalAccountOperation_intent_shape" CHECK (((
    ("action" = 'connect' AND "proposedSourceId" IS NOT NULL
      AND "proposedSourceId" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'
      AND "sourceId" IS NULL AND "targetWorkspaceId" IS NULL
      AND "profileId" IS NOT NULL AND "profileId" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
      AND "displayName" IS NOT NULL AND length("displayName") BETWEEN 1 AND 120
      AND "displayName" = btrim("displayName") AND octet_length("displayName") <= 400
      AND "displayName" !~ '[[:cntrl:]]' AND "ingress" IS NOT NULL AND "ingress" IN ('api-key-create', 'oauth-begin')
      AND "expectedSourceMetadataRevision" IS NULL AND "expectedGatewayRevision" IS NULL
      AND "predecessorBindingId" IS NULL AND "expectedPredecessorRevision" IS NULL
      AND "bindingId" IS NULL AND "expectedBindingRevision" IS NULL)
    OR ("action" IN ('attach', 'revoke') AND "proposedSourceId" IS NULL
      AND "sourceId" IS NOT NULL AND "targetWorkspaceId" IS NOT NULL
      AND "profileId" IS NULL AND "displayName" IS NULL AND "ingress" IS NULL
      AND "expectedGatewayRevision" IS NOT NULL
      AND "expectedSourceMetadataRevision" IS NOT NULL AND "expectedSourceMetadataRevision" BETWEEN 1 AND 2147483646
      AND (("action" = 'attach' AND "bindingId" IS NULL AND "expectedBindingRevision" IS NULL
        AND (("predecessorBindingId" IS NULL AND "expectedPredecessorRevision" IS NULL)
          OR ("predecessorBindingId" IS NOT NULL AND "expectedPredecessorRevision" IS NOT NULL AND "expectedPredecessorRevision" BETWEEN 1 AND 2147483646)))
        OR ("action" = 'revoke' AND "predecessorBindingId" IS NULL AND "expectedPredecessorRevision" IS NULL
          AND "bindingId" IS NOT NULL AND "expectedBindingRevision" IS NOT NULL AND "expectedBindingRevision" BETWEEN 1 AND 2147483646)))
  ) OR (
    "action" IN ('rename','reconnect','retire') AND "sourceId" IS NOT NULL
    AND "proposedSourceId" IS NULL AND "targetWorkspaceId" IS NULL AND "profileId" IS NULL AND "ingress" IS NULL
    AND "predecessorBindingId" IS NULL AND "expectedPredecessorRevision" IS NULL
    AND "bindingId" IS NULL AND "expectedBindingRevision" IS NULL
    AND "expectedSourceMetadataRevision" IS NOT NULL AND "expectedSourceMetadataRevision" BETWEEN 1 AND 2147483646
    AND "expectedGatewayRevision" IS NOT NULL
    AND (("action"='rename' AND "displayName" IS NOT NULL AND length("displayName") BETWEEN 1 AND 120
      AND "displayName"=btrim("displayName") AND octet_length("displayName")<=400 AND "displayName" !~ '[[:cntrl:]]'
      AND "phase" NOT IN ('fencing','ready'))
      OR ("action" IN ('reconnect','retire') AND "displayName" IS NULL AND "phase"<>'reserved'))
  )) IS TRUE);
ALTER TABLE "PersonalAccountOperation" DROP CONSTRAINT "PersonalAccountOperation_result_shape";
ALTER TABLE "PersonalAccountOperation" ADD CONSTRAINT "PersonalAccountOperation_result_shape" CHECK (((
    ("phase" <> 'applied' AND "resultSourceId" IS NULL AND "resultBindingId" IS NULL AND "action" = 'connect')
    OR ("phase" = 'applied' AND "resultSourceId" IS NOT NULL AND "resultBindingId" IS NOT NULL
      AND (("action" = 'connect' AND "resultSourceId" = "proposedSourceId")
        OR ("action" = 'attach' AND "resultSourceId" = "sourceId")
        OR ("action" = 'revoke' AND "resultSourceId" = "sourceId" AND "resultBindingId" = "bindingId")))
  ) OR ("action" IN ('rename','reconnect','retire') AND "resultBindingId" IS NULL AND
    (("phase"='applied' AND "resultSourceId" IS NOT NULL AND "resultSourceId"="sourceId")
      OR ("phase"<>'applied' AND "resultSourceId" IS NULL)))) IS TRUE);
CREATE UNIQUE INDEX "PersonalAccountOperation_pending_canonical_source" ON "PersonalAccountOperation"("sourceId")
  WHERE "action" IN ('rename','reconnect','retire') AND "phase" NOT IN ('applied','rejected');

CREATE OR REPLACE FUNCTION personal_account_operation_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE owner_id TEXT; binding_row "WorkspaceAccountBinding"; predecessor_row "WorkspaceAccountBinding";
BEGIN

  IF COALESCE(NEW."action", OLD."action") IN ('rename','reconnect','retire') THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'personal_operation_retained' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' THEN
      IF (NEW."action" = 'rename' AND NEW."phase" <> 'reserved') OR
        (NEW."action" <> 'rename' AND NEW."phase" <> 'fencing') THEN
        RAISE EXCEPTION 'personal_canonical_initial_phase' USING ERRCODE = '23514';
      END IF;
    ELSE
      IF ROW(NEW."id",NEW."actorUserId",NEW."clientOperationId",NEW."action",NEW."personalWorkspaceId",NEW."sourceId",NEW."displayName",NEW."normalizedIntentHash",NEW."expectedSourceMetadataRevision",NEW."expectedGatewayRevision",NEW."expectedAuthorizationEpoch",NEW."createdAt")
        IS DISTINCT FROM ROW(OLD."id",OLD."actorUserId",OLD."clientOperationId",OLD."action",OLD."personalWorkspaceId",OLD."sourceId",OLD."displayName",OLD."normalizedIntentHash",OLD."expectedSourceMetadataRevision",OLD."expectedGatewayRevision",OLD."expectedAuthorizationEpoch",OLD."createdAt")
        OR (OLD."phase" IN ('applied','rejected') AND ROW(NEW."phase",NEW."resultSourceId",NEW."resultBindingId") IS DISTINCT FROM ROW(OLD."phase",OLD."resultSourceId",OLD."resultBindingId"))
        OR (OLD."phase" = 'reserved' AND NEW."phase" NOT IN ('reserved','submitted'))
        OR (OLD."phase" = 'fencing' AND NEW."phase" NOT IN ('fencing','ready'))
        OR (OLD."phase" = 'ready' AND NEW."phase" NOT IN ('ready','submitted'))
        OR (OLD."phase" IN ('submitted','unknown') AND NEW."phase" NOT IN ('unknown','applied','rejected')) THEN
        RAISE EXCEPTION 'personal_canonical_immutable' USING ERRCODE = '23514';
      END IF;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "ProviderAccountConnection" s JOIN "Workspace" p ON p."id" = NEW."personalWorkspaceId"
      WHERE s."id" = NEW."sourceId" AND s."ownerUserId" = NEW."actorUserId" AND s."ownerWorkspaceId" IS NULL
        AND p."personalOwnerUserId" = NEW."actorUserId") THEN
      RAISE EXCEPTION 'personal_canonical_owner_scope' USING ERRCODE = '23514';
    END IF;
    IF NEW."action" <> 'rename' AND NEW."phase" IN ('ready','submitted') THEN
      IF NOT EXISTS (SELECT 1 FROM "ProviderAccountConnection" WHERE "id"=NEW."sourceId" AND "pendingSourceOperationId"=NEW."id" AND "state"='pending')
        OR EXISTS (SELECT 1 FROM "WorkspaceAccountBinding" WHERE "connectionId"=NEW."sourceId" AND "pendingFenceOperationId" IS NOT NULL) THEN
        RAISE EXCEPTION 'personal_canonical_fences_required' USING ERRCODE = '23514';
      END IF;
    END IF;
    IF NEW."phase"='applied' AND NOT EXISTS (SELECT 1 FROM "ProviderAccountConnection" WHERE "id"=NEW."sourceId"
      AND "gatewayOperationRef"=NEW."id" AND "pendingSourceOperationId" IS NULL
      AND (CASE WHEN NEW."action"='rename' THEN "authorizationEpochMirror"=NEW."expectedAuthorizationEpoch"
        ELSE "authorizationEpochMirror">NEW."expectedAuthorizationEpoch" END)
      AND (NEW."action"<>'retire' OR "state"='disabled')) THEN
      RAISE EXCEPTION 'personal_canonical_applied_join' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP <> 'DELETE' AND NEW."expectedAuthorizationEpoch" IS NOT NULL THEN
    RAISE EXCEPTION 'personal_legacy_epoch_shape' USING ERRCODE='23514';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'personal_operation_retained' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW."id", NEW."actorUserId", NEW."clientOperationId", NEW."action", NEW."personalWorkspaceId", NEW."proposedSourceId", NEW."sourceId", NEW."targetWorkspaceId", NEW."profileId", NEW."displayName", NEW."ingress", NEW."normalizedIntentHash", NEW."expectedSourceMetadataRevision", NEW."expectedGatewayRevision", NEW."predecessorBindingId", NEW."expectedPredecessorRevision", NEW."bindingId", NEW."expectedBindingRevision", NEW."createdAt")
      IS DISTINCT FROM ROW(OLD."id", OLD."actorUserId", OLD."clientOperationId", OLD."action", OLD."personalWorkspaceId", OLD."proposedSourceId", OLD."sourceId", OLD."targetWorkspaceId", OLD."profileId", OLD."displayName", OLD."ingress", OLD."normalizedIntentHash", OLD."expectedSourceMetadataRevision", OLD."expectedGatewayRevision", OLD."predecessorBindingId", OLD."expectedPredecessorRevision", OLD."bindingId", OLD."expectedBindingRevision", OLD."createdAt")
      OR (OLD."phase" IN ('applied', 'rejected') AND ROW(NEW."phase", NEW."resultSourceId", NEW."resultBindingId") IS DISTINCT FROM ROW(OLD."phase", OLD."resultSourceId", OLD."resultBindingId"))
      OR (OLD."phase" = 'reserved' AND NEW."phase" NOT IN ('reserved', 'submitted'))
      OR (OLD."phase" IN ('submitted', 'unknown') AND NEW."phase" NOT IN ('submitted', 'unknown', 'applied', 'rejected'))
      OR (OLD."phase" = 'unknown' AND NEW."phase" = 'submitted') THEN
      RAISE EXCEPTION 'personal_operation_immutable' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."phase" <> 'reserved' AND NEW."action" = 'connect' THEN
    RAISE EXCEPTION 'personal_operation_initial_phase' USING ERRCODE = '23514';
  END IF;
  owner_id := NEW."actorUserId";
  IF NEW."action" <> 'connect' THEN
    SELECT "ownerUserId" INTO owner_id FROM "ProviderAccountConnection" WHERE "id" = NEW."sourceId";
    IF owner_id IS NULL OR (NEW."action" = 'attach' AND owner_id <> NEW."actorUserId") THEN
      RAISE EXCEPTION 'personal_operation_owner' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "Workspace" WHERE "id" = NEW."targetWorkspaceId" AND "personalOwnerUserId" IS NULL) THEN
      RAISE EXCEPTION 'personal_operation_target' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Workspace" WHERE "id" = NEW."personalWorkspaceId" AND "personalOwnerUserId" = owner_id) THEN
    RAISE EXCEPTION 'personal_operation_scope' USING ERRCODE = '23514';
  END IF;
  IF NEW."phase" = 'applied' THEN
    SELECT * INTO binding_row FROM "WorkspaceAccountBinding" WHERE "id" = NEW."resultBindingId";
    IF binding_row."id" IS NULL OR binding_row."connectionId" IS DISTINCT FROM NEW."resultSourceId"
      OR binding_row."workspaceId" IS DISTINCT FROM COALESCE(NEW."targetWorkspaceId", NEW."personalWorkspaceId")
      OR NOT EXISTS (SELECT 1 FROM "ProviderAccountConnection" WHERE "id" = NEW."resultSourceId" AND "ownerUserId" = owner_id) THEN
      RAISE EXCEPTION 'personal_operation_result_join' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' OR OLD."phase" <> 'applied' THEN
      IF NEW."action" IN ('connect', 'attach') AND (binding_row."state" <> 'active' OR binding_row."revision" <> 1) THEN
        RAISE EXCEPTION 'personal_operation_fresh_result' USING ERRCODE = '23514';
      END IF;
      IF NEW."action" = 'connect' AND NOT EXISTS (SELECT 1 FROM "ProviderAccountConnection"
        WHERE "id" = NEW."proposedSourceId" AND "profileRef" = NEW."profileId" AND "displayName" = NEW."displayName"
          AND "gatewayOperationRef" = NEW."id" AND "authorizationEpochMirror" IS NOT NULL) THEN
        RAISE EXCEPTION 'personal_operation_connect_join' USING ERRCODE = '23514';
      END IF;
      IF NEW."action" = 'revoke' AND (binding_row."state" <> 'revoked' OR binding_row."revision" <> NEW."expectedBindingRevision" + 1
        OR binding_row."pendingFenceOperationId" IS DISTINCT FROM NEW."id") THEN
        RAISE EXCEPTION 'personal_operation_revoke_join' USING ERRCODE = '23514';
      END IF;
      IF NEW."action" = 'attach' THEN
        IF NEW."predecessorBindingId" IS NULL THEN
          IF EXISTS (SELECT 1 FROM "WorkspaceAccountBinding" WHERE "connectionId" = NEW."sourceId" AND "workspaceId" = NEW."targetWorkspaceId" AND "id" <> NEW."resultBindingId") THEN
            RAISE EXCEPTION 'personal_operation_unissued_root' USING ERRCODE = '23514';
          END IF;
        ELSE
          SELECT * INTO predecessor_row FROM "WorkspaceAccountBinding" WHERE "id" = NEW."predecessorBindingId";
          IF predecessor_row."connectionId" IS DISTINCT FROM NEW."sourceId" OR predecessor_row."workspaceId" IS DISTINCT FROM NEW."targetWorkspaceId"
            OR predecessor_row."state" IS DISTINCT FROM 'revoked' OR predecessor_row."revision" IS DISTINCT FROM NEW."expectedPredecessorRevision"
            OR predecessor_row."pendingFenceOperationId" IS NOT NULL OR predecessor_row."fenceAckPolicyRevision" IS DISTINCT FROM predecessor_row."policyRevision"
            OR NOT EXISTS (SELECT 1 FROM "PersonalAccountOperation" WHERE "action" = 'attach' AND "phase" = 'applied'
              AND "sourceId" = NEW."sourceId" AND "targetWorkspaceId" = NEW."targetWorkspaceId" AND "resultBindingId" = NEW."predecessorBindingId") THEN
            RAISE EXCEPTION 'personal_operation_predecessor' USING ERRCODE = '23514';
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION workspace_account_binding_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."revision" <> 1 OR NEW."policyRevision" <> 1
      OR NEW."state" <> 'active'
      OR NEW."pendingFenceOperationId" IS NOT NULL
      OR NEW."pendingFencePolicySubject" IS NOT NULL
      OR NEW."pendingFencePolicyRevision" IS NOT NULL
      OR NEW."fenceAckOperationId" IS NOT NULL
      OR NEW."fenceAckPolicyRevision" IS NOT NULL THEN
      RAISE EXCEPTION 'workspace_account_binding_initial_revision' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW."id" IS DISTINCT FROM OLD."id"
      OR NEW."workspaceId" IS DISTINCT FROM OLD."workspaceId"
      OR NEW."connectionId" IS DISTINCT FROM OLD."connectionId"
      OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
      RAISE EXCEPTION 'workspace_account_binding_identity_immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW."revision" = OLD."revision" AND NEW."policyRevision" = OLD."policyRevision" THEN
      -- Only exact ACK bookkeeping (or a no-op) may retain both versions.
      IF NEW."state" IS DISTINCT FROM OLD."state" THEN
        RAISE EXCEPTION 'workspace_account_binding_ack_authority' USING ERRCODE = '23514';
      END IF;
      IF ROW(NEW."pendingFenceOperationId", NEW."pendingFencePolicySubject", NEW."pendingFencePolicyRevision", NEW."fenceAckOperationId", NEW."fenceAckPolicyRevision")
        IS DISTINCT FROM ROW(OLD."pendingFenceOperationId", OLD."pendingFencePolicySubject", OLD."pendingFencePolicyRevision", OLD."fenceAckOperationId", OLD."fenceAckPolicyRevision") THEN
        IF OLD."pendingFenceOperationId" IS NULL
          OR NEW."pendingFenceOperationId" IS NOT NULL
          OR NEW."pendingFencePolicySubject" IS NOT NULL
          OR NEW."pendingFencePolicyRevision" IS NOT NULL
          OR NEW."fenceAckOperationId" IS DISTINCT FROM OLD."pendingFenceOperationId"
          OR NEW."fenceAckPolicyRevision" IS DISTINCT FROM OLD."pendingFencePolicyRevision" THEN
          RAISE EXCEPTION 'workspace_account_binding_ack_conflict' USING ERRCODE = '23514';
        END IF;
      END IF;
    ELSE
      IF NEW."revision"::bigint <> OLD."revision"::bigint + 1
        OR NEW."policyRevision"::bigint <> OLD."policyRevision"::bigint + 1 THEN
        RAISE EXCEPTION 'workspace_account_binding_revision_conflict' USING ERRCODE = '23514';
      END IF;
      -- A grant/revoke cannot also invent an ACK.
      IF ROW(NEW."fenceAckOperationId", NEW."fenceAckPolicyRevision")
        IS DISTINCT FROM ROW(OLD."fenceAckOperationId", OLD."fenceAckPolicyRevision") THEN
        RAISE EXCEPTION 'workspace_account_binding_ack_authority' USING ERRCODE = '23514';
      END IF;
      IF NEW."state" = 'revoked' THEN
        IF NEW."pendingFencePolicySubject" IS DISTINCT FROM NEW."id"
          OR NEW."pendingFencePolicyRevision" IS DISTINCT FROM NEW."policyRevision"
          OR NEW."pendingFenceOperationId" IS NULL
          OR NEW."pendingFenceOperationId" IS NOT DISTINCT FROM OLD."pendingFenceOperationId"
          OR NEW."pendingFenceOperationId" IS NOT DISTINCT FROM OLD."fenceAckOperationId" THEN
          RAISE EXCEPTION 'workspace_account_binding_revoke_intent' USING ERRCODE = '23514';
        END IF;
      ELSIF ROW(NEW."pendingFenceOperationId", NEW."pendingFencePolicySubject", NEW."pendingFencePolicyRevision")
        IS DISTINCT FROM ROW(OLD."pendingFenceOperationId", OLD."pendingFencePolicySubject", OLD."pendingFencePolicyRevision") THEN
        -- Only an existing canonical reconnect reservation can introduce a
        -- fence on a still-active personal ref. Exact ACK remains SQL118's CAS.
        IF OLD."pendingFenceOperationId" IS NOT NULL OR NEW."pendingFenceOperationId" IS NULL
          OR NEW."pendingFencePolicySubject" IS DISTINCT FROM NEW."id"
          OR NEW."pendingFencePolicyRevision" IS DISTINCT FROM NEW."policyRevision"
          OR NOT EXISTS (SELECT 1 FROM "ProviderAccountConnection" s JOIN "PersonalAccountOperation" o ON o."id"=s."pendingSourceOperationId"
            WHERE s."id"=OLD."connectionId" AND s."ownerUserId" IS NOT NULL AND s."state"='pending'
              AND o."sourceId"=s."id" AND o."actorUserId"=s."ownerUserId" AND o."action"='reconnect' AND o."phase"='fencing') THEN
          RAISE EXCEPTION 'workspace_account_binding_grant_drops_fence' USING ERRCODE = '23514';
        END IF;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
