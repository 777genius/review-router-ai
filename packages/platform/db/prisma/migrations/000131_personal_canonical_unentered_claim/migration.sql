-- Positive local pre-ingress authorization failure may release only a submitted
-- claim. The repository requires the winning exact updatedAt token; unknown and
-- terminal phases remain irreversible. Keep source pending/fences untouched.
-- Full explicit guard body preserves the frozen SQL130 noncanonical contracts.
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
