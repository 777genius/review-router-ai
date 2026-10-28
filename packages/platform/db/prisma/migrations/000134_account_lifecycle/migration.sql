-- Additive account lifecycle. Disabled rows and historical operation IDs remain intact.
-- Commit the enum before any function or constraint can use the new value.
ALTER TYPE "ProviderAccountConnectionState" ADD VALUE 'suspended';
BEGIN;
ALTER TABLE "PersonalAccountOperation"
  ALTER COLUMN "personalWorkspaceId" DROP NOT NULL,
  ADD COLUMN "owningWorkspaceId" TEXT REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD COLUMN "originalOperationId" TEXT,
  ADD COLUMN "noEffectRejectionProofRef" TEXT,
  ADD COLUMN "deleteRemoteRetirementProofRef" TEXT,
  ADD COLUMN "deleteBindingErasureProofRef" TEXT,
  ADD COLUMN "deleteTransportErasureProofRef" TEXT,
  ADD COLUMN "deleteNativeErasureProofRef" TEXT;
ALTER TABLE "PersonalAccountOperation" DROP CONSTRAINT "PersonalAccountOperation_action_check";
ALTER TABLE "PersonalAccountOperation" ADD CONSTRAINT "PersonalAccountOperation_action_check"
  CHECK ("action" IN ('connect','attach','revoke','rename','reconnect','retire','suspend','resume','delete'));
ALTER TABLE "PersonalAccountOperation" ADD CONSTRAINT "PersonalAccountOperation_owner_scope" CHECK ((
  ("action" IN ('suspend','resume','delete') AND
    (("personalWorkspaceId" IS NOT NULL AND "owningWorkspaceId" IS NULL) OR
     ("personalWorkspaceId" IS NULL AND "owningWorkspaceId" IS NOT NULL))
    AND "originalOperationId" IS NOT NULL AND "originalOperationId"="id")
  OR ("action" NOT IN ('suspend','resume','delete') AND "personalWorkspaceId" IS NOT NULL
    AND "owningWorkspaceId" IS NULL AND "originalOperationId" IS NULL
    AND "noEffectRejectionProofRef" IS NULL AND "deleteRemoteRetirementProofRef" IS NULL
    AND "deleteBindingErasureProofRef" IS NULL AND "deleteTransportErasureProofRef" IS NULL
    AND "deleteNativeErasureProofRef" IS NULL)
) IS TRUE);
ALTER TABLE "PersonalAccountOperation" ADD CONSTRAINT "PersonalAccountOperation_closure_shape" CHECK ((
  ("noEffectRejectionProofRef" IS NULL OR ("phase"='rejected' AND "noEffectRejectionProofRef" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'))
  AND ("deleteRemoteRetirementProofRef" IS NULL OR ("action"='delete' AND "deleteRemoteRetirementProofRef" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'))
  AND ("deleteBindingErasureProofRef" IS NULL OR ("action"='delete' AND "deleteBindingErasureProofRef" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'))
  AND ("deleteTransportErasureProofRef" IS NULL OR ("action"='delete' AND "deleteTransportErasureProofRef" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'))
  AND ("deleteNativeErasureProofRef" IS NULL OR ("action"='delete' AND "deleteNativeErasureProofRef" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'))
  AND ("action"<>'delete' OR "phase"<>'applied' OR
    ("deleteRemoteRetirementProofRef" IS NOT NULL AND "deleteBindingErasureProofRef" IS NOT NULL
     AND "deleteTransportErasureProofRef" IS NOT NULL AND "deleteNativeErasureProofRef" IS NOT NULL))
) IS TRUE);
ALTER TABLE "PersonalAccountOperation" DROP CONSTRAINT "PersonalAccountOperation_epoch_shape";
ALTER TABLE "PersonalAccountOperation" ADD CONSTRAINT "PersonalAccountOperation_epoch_shape" CHECK (
  ("action" IN ('rename','reconnect','retire','suspend','resume','delete') AND "expectedAuthorizationEpoch" IS NOT NULL
    AND "expectedAuthorizationEpoch" BETWEEN 1 AND 9007199254740991)
  OR ("action" NOT IN ('rename','reconnect','retire','suspend','resume','delete') AND "expectedAuthorizationEpoch" IS NULL));
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
  ) OR ("action" IN ('suspend','resume','delete') AND "sourceId" IS NOT NULL
    AND "proposedSourceId" IS NULL AND "targetWorkspaceId" IS NULL AND "profileId" IS NULL
    AND "displayName" IS NULL AND "ingress" IS NULL AND "predecessorBindingId" IS NULL
    AND "expectedPredecessorRevision" IS NULL AND "bindingId" IS NULL AND "expectedBindingRevision" IS NULL
    AND "expectedSourceMetadataRevision" IS NOT NULL AND "expectedSourceMetadataRevision" BETWEEN 1 AND 2147483645
    AND "expectedGatewayRevision" IS NOT NULL AND "phase"<>'reserved')) IS TRUE);
ALTER TABLE "PersonalAccountOperation" DROP CONSTRAINT "PersonalAccountOperation_result_shape";
ALTER TABLE "PersonalAccountOperation" ADD CONSTRAINT "PersonalAccountOperation_result_shape" CHECK (((
    ("phase" <> 'applied' AND "resultSourceId" IS NULL AND "resultBindingId" IS NULL AND "action" = 'connect')
    OR ("phase" = 'applied' AND "resultSourceId" IS NOT NULL AND "resultBindingId" IS NOT NULL
      AND (("action" = 'connect' AND "resultSourceId" = "proposedSourceId")
        OR ("action" = 'attach' AND "resultSourceId" = "sourceId")
        OR ("action" = 'revoke' AND "resultSourceId" = "sourceId" AND "resultBindingId" = "bindingId")))
  ) OR ("action" IN ('rename','reconnect','retire') AND "resultBindingId" IS NULL AND
    (("phase"='applied' AND "resultSourceId" IS NOT NULL AND "resultSourceId"="sourceId")
      OR ("phase"<>'applied' AND "resultSourceId" IS NULL))) OR ("action" IN ('suspend','resume','delete') AND "resultBindingId" IS NULL AND
    (("phase"='applied' AND "resultSourceId" IS NOT NULL AND "resultSourceId"="sourceId")
    OR ("phase"<>'applied' AND "resultSourceId" IS NULL)))) IS TRUE);
DROP INDEX "PersonalAccountOperation_pending_canonical_source";
CREATE UNIQUE INDEX "PersonalAccountOperation_pending_canonical_source" ON "PersonalAccountOperation"("sourceId")
  WHERE "action" IN ('rename','reconnect','retire','suspend','resume','delete') AND "phase" NOT IN ('applied','rejected');
CREATE UNIQUE INDEX "PersonalAccountOperation_delete_source" ON "PersonalAccountOperation"("sourceId") WHERE "action"='delete';

CREATE OR REPLACE FUNCTION personal_account_operation_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE owner_id TEXT; binding_row "WorkspaceAccountBinding"; predecessor_row "WorkspaceAccountBinding";
BEGIN
  IF TG_OP <> 'DELETE' AND NEW."action" NOT IN ('suspend','resume','delete') AND (NEW."owningWorkspaceId" IS NOT NULL OR NEW."personalWorkspaceId" IS NULL
    OR NEW."originalOperationId" IS NOT NULL OR NEW."noEffectRejectionProofRef" IS NOT NULL
    OR NEW."deleteRemoteRetirementProofRef" IS NOT NULL OR NEW."deleteBindingErasureProofRef" IS NOT NULL
    OR NEW."deleteTransportErasureProofRef" IS NOT NULL OR NEW."deleteNativeErasureProofRef" IS NOT NULL) THEN
    RAISE EXCEPTION 'personal_legacy_scope_shape' USING ERRCODE='23514';
  END IF;
  IF COALESCE(NEW."action", OLD."action") IN ('suspend','resume','delete') THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'lifecycle_operation_retained' USING ERRCODE='23514'; END IF;
    IF TG_OP='INSERT' THEN
      IF NEW."phase"<>'fencing' OR NEW."noEffectRejectionProofRef" IS NOT NULL
        OR NEW."deleteRemoteRetirementProofRef" IS NOT NULL OR NEW."deleteBindingErasureProofRef" IS NOT NULL
        OR NEW."deleteTransportErasureProofRef" IS NOT NULL OR NEW."deleteNativeErasureProofRef" IS NOT NULL THEN
        RAISE EXCEPTION 'lifecycle_initial_phase' USING ERRCODE='23514';
      END IF;
    ELSE
      IF ROW(NEW."id",NEW."actorUserId",NEW."clientOperationId",NEW."action",NEW."personalWorkspaceId",NEW."owningWorkspaceId",NEW."originalOperationId",NEW."sourceId",NEW."proposedSourceId",NEW."targetWorkspaceId",NEW."profileId",NEW."displayName",NEW."ingress",NEW."normalizedIntentHash",NEW."expectedSourceMetadataRevision",NEW."expectedGatewayRevision",NEW."expectedAuthorizationEpoch",NEW."predecessorBindingId",NEW."expectedPredecessorRevision",NEW."bindingId",NEW."expectedBindingRevision",NEW."createdAt")
        IS DISTINCT FROM ROW(OLD."id",OLD."actorUserId",OLD."clientOperationId",OLD."action",OLD."personalWorkspaceId",OLD."owningWorkspaceId",OLD."originalOperationId",OLD."sourceId",OLD."proposedSourceId",OLD."targetWorkspaceId",OLD."profileId",OLD."displayName",OLD."ingress",OLD."normalizedIntentHash",OLD."expectedSourceMetadataRevision",OLD."expectedGatewayRevision",OLD."expectedAuthorizationEpoch",OLD."predecessorBindingId",OLD."expectedPredecessorRevision",OLD."bindingId",OLD."expectedBindingRevision",OLD."createdAt")
        OR (OLD."phase" IN ('applied','rejected') AND (to_jsonb(NEW)-'updatedAt') IS DISTINCT FROM (to_jsonb(OLD)-'updatedAt'))
        OR (OLD."phase"='fencing' AND NEW."phase" NOT IN ('fencing','ready'))
        OR (OLD."phase"='ready' AND NEW."phase" NOT IN ('ready','submitted'))
        OR (OLD."phase"='unknown' AND NEW."phase" NOT IN ('unknown','applied','rejected'))
        OR (OLD."phase"='submitted' AND NEW."phase" NOT IN ('submitted','unknown','applied','rejected')
          AND NOT (NEW."phase"='fencing' AND NEW."updatedAt">OLD."updatedAt"
            AND OLD."noEffectRejectionProofRef" IS NULL AND OLD."deleteRemoteRetirementProofRef" IS NULL
            AND EXISTS (SELECT 1 FROM "ProviderAccountConnection" s WHERE s."id"=NEW."sourceId" AND s."pendingSourceOperationId"=NEW."id" AND s."state"='pending')))
        OR (OLD."noEffectRejectionProofRef" IS NOT NULL AND NEW."noEffectRejectionProofRef" IS DISTINCT FROM OLD."noEffectRejectionProofRef")
        OR (OLD."deleteRemoteRetirementProofRef" IS NOT NULL AND NEW."deleteRemoteRetirementProofRef" IS DISTINCT FROM OLD."deleteRemoteRetirementProofRef")
        OR (OLD."deleteBindingErasureProofRef" IS NOT NULL AND NEW."deleteBindingErasureProofRef" IS DISTINCT FROM OLD."deleteBindingErasureProofRef")
        OR (OLD."deleteTransportErasureProofRef" IS NOT NULL AND NEW."deleteTransportErasureProofRef" IS DISTINCT FROM OLD."deleteTransportErasureProofRef")
        OR (OLD."deleteNativeErasureProofRef" IS NOT NULL AND NEW."deleteNativeErasureProofRef" IS DISTINCT FROM OLD."deleteNativeErasureProofRef") THEN
        RAISE EXCEPTION 'lifecycle_operation_immutable' USING ERRCODE='23514';
      END IF;
    END IF;
    -- Lock authority before Source. Current advancing admin is additionally checked
    -- by the adapter; the immutable initiator need not retain their old role.
    PERFORM "id" FROM "User" WHERE "id"=NEW."actorUserId" FOR KEY SHARE;
    PERFORM "id" FROM "Workspace" WHERE "id"=COALESCE(NEW."personalWorkspaceId",NEW."owningWorkspaceId") FOR SHARE;
    IF TG_OP='INSERT' AND NEW."owningWorkspaceId" IS NOT NULL THEN
      PERFORM "id" FROM "WorkspaceMember" WHERE "workspaceId"=NEW."owningWorkspaceId" AND "userId"=NEW."actorUserId" FOR SHARE;
    END IF;
    PERFORM "id" FROM "ProviderAccountConnection" WHERE "id"=NEW."sourceId" FOR UPDATE;
    IF NOT EXISTS (SELECT 1 FROM "ProviderAccountConnection" s JOIN "Workspace" w ON w."id"=COALESCE(NEW."personalWorkspaceId",NEW."owningWorkspaceId")
      WHERE s."id"=NEW."sourceId" AND w."deletionState"='active'
        AND ((NEW."personalWorkspaceId" IS NOT NULL AND NEW."owningWorkspaceId" IS NULL
          AND s."ownerUserId"=NEW."actorUserId" AND s."ownerWorkspaceId" IS NULL AND w."personalOwnerUserId"=NEW."actorUserId")
        OR (NEW."owningWorkspaceId" IS NOT NULL AND NEW."personalWorkspaceId" IS NULL
          AND s."ownerWorkspaceId"=NEW."owningWorkspaceId" AND s."ownerUserId" IS NULL AND w."personalOwnerUserId" IS NULL
          AND (TG_OP<>'INSERT' OR EXISTS (SELECT 1 FROM "WorkspaceMember" m WHERE m."workspaceId"=w."id" AND m."userId"=NEW."actorUserId" AND m."role" IN ('owner','admin')))))) THEN
      RAISE EXCEPTION 'lifecycle_owner_scope' USING ERRCODE='23514';
    END IF;
    IF TG_OP='INSERT' AND NOT EXISTS (SELECT 1 FROM "ProviderAccountConnection" s WHERE s."id"=NEW."sourceId"
      AND s."pendingSourceOperationId" IS NULL AND s."profileRef" IS NOT NULL
      AND s."metadataRevision"=NEW."expectedSourceMetadataRevision"
      AND (s."authorizationEpochMirror"=NEW."expectedAuthorizationEpoch" OR (s."authorizationEpochMirror" IS NULL AND NEW."owningWorkspaceId" IS NOT NULL))
      AND ((NEW."action"='suspend' AND s."state"='active') OR (NEW."action"='resume' AND s."state"='suspended')
        OR (NEW."action"='delete' AND s."state" IN ('active','suspended','quarantined')))
      AND NOT EXISTS (SELECT 1 FROM "PersonalAccountOperation" d WHERE d."sourceId"=s."id" AND d."action"='delete')) THEN
      RAISE EXCEPTION 'lifecycle_source_cas' USING ERRCODE='23514';
    END IF;
    IF NEW."phase" IN ('ready','submitted') AND (
      NOT EXISTS (SELECT 1 FROM "ProviderAccountConnection" s WHERE s."id"=NEW."sourceId" AND s."pendingSourceOperationId"=NEW."id" AND s."state"='pending')
      OR EXISTS (SELECT 1 FROM "WorkspaceAccountBinding" b WHERE b."connectionId"=NEW."sourceId" AND b."pendingFenceOperationId" IS NOT NULL)
      OR (NEW."action"='delete' AND EXISTS (SELECT 1 FROM "WorkspaceAccountBinding" b WHERE b."connectionId"=NEW."sourceId" AND b."state"='active'))) THEN
      RAISE EXCEPTION 'lifecycle_fences_required' USING ERRCODE='23514';
    END IF;
    IF NEW."phase"='rejected' AND NEW."noEffectRejectionProofRef" IS NULL THEN
      RAISE EXCEPTION 'lifecycle_no_effect_proof_required' USING ERRCODE='23514';
    END IF;
    IF NEW."phase"='applied' AND NOT EXISTS (SELECT 1 FROM "ProviderAccountConnection" s WHERE s."id"=NEW."sourceId"
      AND s."gatewayOperationRef"=NEW."id" AND s."authorizationEpochMirror">NEW."expectedAuthorizationEpoch"
      AND s."metadataRevision"=NEW."expectedSourceMetadataRevision"+2
      AND ((NEW."action"='delete' AND s."state"='disabled' AND s."pendingSourceOperationId"=NEW."id")
        OR (NEW."action"='suspend' AND s."state"='suspended' AND s."pendingSourceOperationId" IS NULL)
        OR (NEW."action"='resume' AND s."state"='active' AND s."pendingSourceOperationId" IS NULL))) THEN
      RAISE EXCEPTION 'lifecycle_applied_join' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;


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
        OR (OLD."phase" = 'unknown' AND NEW."phase" NOT IN ('unknown','applied','rejected'))
        OR (OLD."phase" = 'submitted' AND NEW."phase" NOT IN ('unknown','applied','rejected')
          AND NOT (NEW."updatedAt" > OLD."updatedAt" AND
            ((NEW."action" = 'rename' AND NEW."phase" = 'reserved')
            OR (NEW."action" IN ('reconnect','retire') AND NEW."phase" = 'fencing'
              AND EXISTS (SELECT 1 FROM "ProviderAccountConnection" s
                WHERE s."id"=NEW."sourceId" AND s."pendingSourceOperationId"=NEW."id" AND s."state"='pending'))))) THEN
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
              AND o."sourceId"=s."id" AND o."actorUserId"=s."ownerUserId" AND o."action"='reconnect' AND o."phase"='fencing')
          AND NOT EXISTS (SELECT 1 FROM "ProviderAccountConnection" s JOIN "PersonalAccountOperation" o ON o."id"=s."pendingSourceOperationId"
            WHERE s."id"=OLD."connectionId" AND s."state"='pending' AND o."sourceId"=s."id"
              AND o."action" IN ('suspend','resume') AND o."phase"='fencing'
              AND ((s."ownerUserId" IS NOT NULL AND s."ownerUserId"=o."actorUserId" AND o."personalWorkspaceId" IS NOT NULL AND o."owningWorkspaceId" IS NULL)
                OR (s."ownerWorkspaceId" IS NOT NULL AND s."ownerWorkspaceId"=o."owningWorkspaceId" AND o."personalWorkspaceId" IS NULL))
              AND NEW."pendingFenceOperationId"='rrpf_' || encode(sha256(convert_to('["rr-personal-source-fence-v1","'||o."id"||'","'||NEW."id"||'"]','UTF8')),'hex')) THEN
          RAISE EXCEPTION 'workspace_account_binding_grant_drops_fence' USING ERRCODE = '23514';
        END IF;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- NULL-safe owner scope for both old and new journal records. Never pass SQL NULL
-- to a negated authority predicate (NULL would silently bypass an IF).
CREATE OR REPLACE FUNCTION rr_personal_operation_delete_admission() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='INSERT' OR NEW."personalWorkspaceId" IS DISTINCT FROM OLD."personalWorkspaceId"
    OR NEW."owningWorkspaceId" IS DISTINCT FROM OLD."owningWorkspaceId"
    OR NEW."targetWorkspaceId" IS DISTINCT FROM OLD."targetWorkspaceId"
    OR (NEW."phase" IN ('submitted','applied') AND OLD."phase" NOT IN ('submitted','applied')) THEN
    IF public.rr_workspace_delete_admission(COALESCE(NEW."personalWorkspaceId",NEW."owningWorkspaceId")) IS NOT TRUE
      OR (NEW."targetWorkspaceId" IS NOT NULL AND public.rr_workspace_delete_admission(NEW."targetWorkspaceId") IS NOT TRUE) THEN
      RAISE EXCEPTION 'workspace_deletion_admission_denied';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Separate additive guard leaves historical SQL117 ownership/revision enforcement intact.
CREATE FUNCTION rr_account_lifecycle_source_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE operation "PersonalAccountOperation"; deletion "PersonalAccountOperation";
BEGIN
  SELECT * INTO deletion FROM "PersonalAccountOperation" WHERE "sourceId"=NEW."id" AND "action"='delete';
  IF deletion."id" IS NOT NULL THEN
    IF NEW."pendingSourceOperationId" IS DISTINCT FROM deletion."id"
      OR NEW."state" NOT IN ('pending','disabled')
      OR (TG_OP='UPDATE' AND OLD."state"='disabled') THEN
      RAISE EXCEPTION 'account_delete_permanent_deny' USING ERRCODE='23514';
    END IF;
    IF NEW."state"='disabled' AND (deletion."phase" NOT IN ('submitted','unknown')
      OR deletion."deleteRemoteRetirementProofRef" IS NULL OR deletion."deleteBindingErasureProofRef" IS NULL
      OR deletion."deleteTransportErasureProofRef" IS NULL OR deletion."deleteNativeErasureProofRef" IS NULL) THEN
      RAISE EXCEPTION 'account_delete_closure_required' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_OP='UPDATE' AND OLD."authorizationEpochMirror" IS NOT NULL
    AND (NEW."authorizationEpochMirror" IS NULL OR NEW."authorizationEpochMirror"<OLD."authorizationEpochMirror") THEN
    RAISE EXCEPTION 'account_epoch_monotonic' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND OLD."state"='suspended' AND NEW."state" NOT IN ('suspended','pending') THEN
    RAISE EXCEPTION 'lifecycle_resume_reservation_required' USING ERRCODE='23514';
  END IF;
  IF NEW."pendingSourceOperationId" IS NOT NULL THEN
    SELECT * INTO operation FROM "PersonalAccountOperation" WHERE "id"=NEW."pendingSourceOperationId";
    IF TG_OP='UPDATE' AND OLD."state"='suspended' AND operation."action" NOT IN ('resume','delete') THEN
      RAISE EXCEPTION 'lifecycle_resume_reservation_required' USING ERRCODE='23514';
    END IF;
    IF operation."action" IN ('suspend','resume','delete') THEN
      IF operation."sourceId" IS DISTINCT FROM NEW."id" OR
        (NEW."state"<>'pending' AND NOT (operation."action"='delete' AND NEW."state"='disabled')) THEN
        RAISE EXCEPTION 'lifecycle_source_reservation' USING ERRCODE='23514';
      END IF;
      IF OLD."pendingSourceOperationId" IS NULL THEN
        IF operation."phase"<>'fencing' OR NEW."metadataRevision"<>operation."expectedSourceMetadataRevision"+1
          OR NEW."state"<>'pending' OR NEW."profileRef" IS DISTINCT FROM OLD."profileRef"
          OR NEW."authorizationEpochMirror" IS DISTINCT FROM OLD."authorizationEpochMirror" THEN
          RAISE EXCEPTION 'lifecycle_source_reservation' USING ERRCODE='23514';
        END IF;
      ELSIF OLD."pendingSourceOperationId" IS DISTINCT FROM NEW."pendingSourceOperationId" THEN
        RAISE EXCEPTION 'lifecycle_pending_conflict' USING ERRCODE='23514';
      ELSIF NEW."state"='pending' THEN
        RAISE EXCEPTION 'lifecycle_pending_mirror_denied' USING ERRCODE='23514';
      END IF;
    END IF;
  END IF;
  IF TG_OP='UPDATE' AND OLD."pendingSourceOperationId" IS NOT NULL THEN
    SELECT * INTO operation FROM "PersonalAccountOperation" WHERE "id"=OLD."pendingSourceOperationId";
    IF operation."action" IN ('suspend','resume','delete') AND NEW."state"<>'pending' THEN
      IF NEW."metadataRevision"<>operation."expectedSourceMetadataRevision"+2
        OR NEW."profileRef" IS DISTINCT FROM OLD."profileRef"
        OR EXISTS (SELECT 1 FROM "WorkspaceAccountBinding" WHERE "connectionId"=NEW."id" AND "pendingFenceOperationId" IS NOT NULL)
        OR ((operation."action"<>'delete' AND operation."phase"='rejected' AND operation."noEffectRejectionProofRef" IS NOT NULL
          AND NEW."pendingSourceOperationId" IS NULL AND NEW."authorizationEpochMirror"=operation."expectedAuthorizationEpoch"
          AND NEW."state"=CASE WHEN operation."action"='resume' THEN 'suspended'::"ProviderAccountConnectionState" ELSE 'active'::"ProviderAccountConnectionState" END)
        OR (operation."phase" IN ('submitted','unknown') AND NEW."gatewayOperationRef"=operation."id"
          AND NEW."authorizationEpochMirror">operation."expectedAuthorizationEpoch"
          AND ((operation."action"='suspend' AND NEW."state"='suspended' AND NEW."pendingSourceOperationId" IS NULL)
            OR (operation."action"='resume' AND NEW."state"='active' AND NEW."pendingSourceOperationId" IS NULL)
            OR (operation."action"='delete' AND NEW."state"='disabled' AND NEW."pendingSourceOperationId"=operation."id")))) IS NOT TRUE THEN
        RAISE EXCEPTION 'lifecycle_source_finalize' USING ERRCODE='23514';
      END IF;
    ELSIF operation."action" IN ('suspend','resume','delete') AND NEW."pendingSourceOperationId" IS DISTINCT FROM OLD."pendingSourceOperationId" THEN
      RAISE EXCEPTION 'lifecycle_pending_conflict' USING ERRCODE='23514';
    END IF;
  ELSIF NEW."state"='suspended' THEN
    RAISE EXCEPTION 'lifecycle_suspended_authority' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ProviderAccountConnection_lifecycle" BEFORE INSERT OR UPDATE ON "ProviderAccountConnection"
  FOR EACH ROW EXECUTE FUNCTION rr_account_lifecycle_source_guard();

CREATE FUNCTION rr_account_lifecycle_binding_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE source "ProviderAccountConnection";
BEGIN
  SELECT * INTO source FROM "ProviderAccountConnection" WHERE "id"=NEW."connectionId";
  IF TG_OP='INSERT' OR (NEW."state"='active' AND OLD."state"<>'active') THEN
    IF source."pendingSourceOperationId" IS NOT NULL OR source."state"='suspended'
      OR EXISTS (SELECT 1 FROM "PersonalAccountOperation" WHERE "sourceId"=NEW."connectionId" AND "action"='delete') THEN
      RAISE EXCEPTION 'lifecycle_binding_admission_denied' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_OP='UPDATE' AND OLD."pendingFenceOperationId" IS NOT NULL
    AND NEW."revision"<>OLD."revision" AND EXISTS (
      SELECT 1 FROM "PersonalAccountOperation" o WHERE o."id"=source."pendingSourceOperationId" AND o."action" IN ('suspend','resume','delete')) THEN
    RAISE EXCEPTION 'lifecycle_fence_preserves_unresolved' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "WorkspaceAccountBinding_lifecycle" BEFORE INSERT OR UPDATE ON "WorkspaceAccountBinding"
  FOR EACH ROW EXECUTE FUNCTION rr_account_lifecycle_binding_guard();

COMMIT;
