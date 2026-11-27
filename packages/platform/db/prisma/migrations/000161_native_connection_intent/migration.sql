-- Reader-first native method selection. Existing intent hashes stay unchanged.
BEGIN;
ALTER TABLE "PersonalAccountOperation" ADD COLUMN "nativeConnection" JSONB;
ALTER TABLE "PersonalAccountOperation" DROP CONSTRAINT "PersonalAccountOperation_intent_shape";
ALTER TABLE "PersonalAccountOperation" ADD CONSTRAINT "PersonalAccountOperation_intent_shape" CHECK (((
    ("action" = 'connect' AND "proposedSourceId" IS NOT NULL
      AND "proposedSourceId" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'
      AND "sourceId" IS NULL AND "targetWorkspaceId" IS NULL
      AND "profileId" IS NOT NULL AND "profileId" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
      AND "displayName" IS NOT NULL AND length("displayName") BETWEEN 1 AND 120
      AND "displayName" = btrim("displayName") AND octet_length("displayName") <= 400
      AND "displayName" !~ '[[:cntrl:]]' AND "ingress" IS NOT NULL AND "ingress" IN ('api-key-create', 'oauth-begin', 'credential-import', 'native-begin')
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
ALTER TABLE "PersonalAccountOperation" ADD CONSTRAINT "PersonalAccountOperation_native_connection_shape" CHECK ((
  ("nativeConnection" IS NULL AND "ingress" IS DISTINCT FROM 'native-begin')
  OR (
    jsonb_typeof("nativeConnection") = 'object'
    AND "nativeConnection" ?& ARRAY['schemaVersion','profileId','methodId','methodRevision','configurationGeneration']
    AND "nativeConnection" - ARRAY['schemaVersion','profileId','methodId','methodRevision','configurationGeneration'] = '{}'::jsonb
    AND "nativeConnection"->'schemaVersion' = '1'::jsonb
    AND jsonb_typeof("nativeConnection"->'profileId') = 'string'
    AND jsonb_typeof("nativeConnection"->'methodId') = 'string'
    AND jsonb_typeof("nativeConnection"->'configurationGeneration') = 'string'
    AND jsonb_typeof("nativeConnection"->'methodRevision') = 'number'
    AND ("nativeConnection"->>'methodRevision')::numeric BETWEEN 1 AND 9007199254740991
    AND ("nativeConnection"->>'methodRevision')::numeric = trunc(("nativeConnection"->>'methodRevision')::numeric)
    AND "nativeConnection"->>'profileId' ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'
    AND "nativeConnection"->>'methodId' ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'
    AND "nativeConnection"->>'configurationGeneration' ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'
    AND "credentialImportMethod" IS NULL AND "oauthMethod" IS NULL
    AND (("action" = 'connect' AND "ingress" = 'native-begin' AND "nativeConnection"->>'profileId' = "profileId")
      OR ("action" = 'reconnect' AND "ingress" IS NULL))
  )
) IS TRUE);
CREATE FUNCTION rr_personal_native_connection_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW."nativeConnection" IS DISTINCT FROM OLD."nativeConnection" THEN
    RAISE EXCEPTION 'personal_native_connection_immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "PersonalAccountOperation_native_connection_guard"
  BEFORE UPDATE ON "PersonalAccountOperation"
  FOR EACH ROW EXECUTE FUNCTION rr_personal_native_connection_guard();
COMMIT;
