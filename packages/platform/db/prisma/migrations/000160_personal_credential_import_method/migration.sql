-- Reader-first additive method identity. No credential bytes, fingerprints or OAuth-mode widening.
BEGIN;
ALTER TABLE "PersonalAccountOperation" ADD COLUMN "credentialImportMethod" TEXT;
ALTER TABLE "PersonalAccountOperation" DROP CONSTRAINT "PersonalAccountOperation_intent_shape";
ALTER TABLE "PersonalAccountOperation" ADD CONSTRAINT "PersonalAccountOperation_intent_shape" CHECK (((
    ("action" = 'connect' AND "proposedSourceId" IS NOT NULL
      AND "proposedSourceId" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'
      AND "sourceId" IS NULL AND "targetWorkspaceId" IS NULL
      AND "profileId" IS NOT NULL AND "profileId" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
      AND "displayName" IS NOT NULL AND length("displayName") BETWEEN 1 AND 120
      AND "displayName" = btrim("displayName") AND octet_length("displayName") <= 400
      AND "displayName" !~ '[[:cntrl:]]' AND "ingress" IS NOT NULL AND "ingress" IN ('api-key-create', 'oauth-begin', 'credential-import')
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
ALTER TABLE "PersonalAccountOperation" ADD CONSTRAINT "PersonalAccountOperation_credential_import_shape" CHECK ((
  ("credentialImportMethod" IS NULL AND ("ingress" IS NULL OR "ingress" <> 'credential-import'))
  OR ("credentialImportMethod" IN ('refresh_token','oauth_auth_json') AND "oauthMethod" IS NULL
    AND (("action"='connect' AND "ingress"='credential-import') OR ("action"='reconnect' AND "ingress" IS NULL)))
) IS TRUE);
CREATE FUNCTION rr_personal_credential_import_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW."credentialImportMethod" IS DISTINCT FROM OLD."credentialImportMethod" THEN
    RAISE EXCEPTION 'personal_credential_import_method_immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "PersonalAccountOperation_credential_import_guard"
  BEFORE UPDATE ON "PersonalAccountOperation"
  FOR EACH ROW EXECUTE FUNCTION rr_personal_credential_import_guard();
COMMIT;
