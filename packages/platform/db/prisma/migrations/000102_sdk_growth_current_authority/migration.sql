-- Canonical epoch custody is separate from receipt/grant fencing.
CREATE TABLE "SdkGrowthCurrentAuthority" (
  "scopeKey" TEXT PRIMARY KEY,
  "epoch" BIGINT NOT NULL CHECK ("epoch" >= 0)
);
CREATE TABLE "SdkGrowthBindingVersion" (
  "scopeKey" TEXT NOT NULL REFERENCES "SdkGrowthCurrentAuthority"("scopeKey") ON DELETE RESTRICT,
  "epoch" BIGINT NOT NULL CHECK ("epoch" > 0),
  "binding" JSONB NOT NULL CHECK (octet_length("binding"::text) <= 400000),
  PRIMARY KEY ("scopeKey", "epoch")
);
CREATE TABLE "SdkGrowthOwnerVersion" (
  "scopeKey" TEXT NOT NULL,
  "epoch" BIGINT NOT NULL,
  "evidence" JSONB NOT NULL CHECK (octet_length("evidence"::text) <= 800000),
  "provenance" JSONB NOT NULL CHECK (octet_length("provenance"::text) <= 400000),
  "installationActive" BOOLEAN NOT NULL,
  "verifierActive" BOOLEAN NOT NULL,
  "reason" TEXT NOT NULL CHECK ("reason" IN ('provision', 'binding-replacement', 'owner-replacement', 'owner-revocation', 'installation-invalidation', 'verifier-withdrawal')),
  PRIMARY KEY ("scopeKey", "epoch"),
  FOREIGN KEY ("scopeKey", "epoch") REFERENCES "SdkGrowthBindingVersion"("scopeKey", "epoch") ON DELETE RESTRICT
);
CREATE FUNCTION sdk_growth_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'immutable authority history'; END;
$$;
CREATE TRIGGER sdk_binding_immutable BEFORE UPDATE OR DELETE ON "SdkGrowthBindingVersion" FOR EACH ROW EXECUTE FUNCTION sdk_growth_snapshot_immutable();
CREATE TRIGGER sdk_owner_immutable BEFORE UPDATE OR DELETE ON "SdkGrowthOwnerVersion" FOR EACH ROW EXECUTE FUNCTION sdk_growth_snapshot_immutable();
CREATE TRIGGER sdk_binding_no_truncate BEFORE TRUNCATE ON "SdkGrowthBindingVersion" FOR EACH STATEMENT EXECUTE FUNCTION sdk_growth_snapshot_immutable();
CREATE TRIGGER sdk_owner_no_truncate BEFORE TRUNCATE ON "SdkGrowthOwnerVersion" FOR EACH STATEMENT EXECUTE FUNCTION sdk_growth_snapshot_immutable();
CREATE TRIGGER sdk_current_no_delete BEFORE DELETE ON "SdkGrowthCurrentAuthority" FOR EACH ROW EXECUTE FUNCTION sdk_growth_snapshot_immutable();
CREATE TRIGGER sdk_current_no_truncate BEFORE TRUNCATE ON "SdkGrowthCurrentAuthority" FOR EACH STATEMENT EXECUTE FUNCTION sdk_growth_snapshot_immutable();
CREATE FUNCTION sdk_growth_snapshot_advance() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  old_binding JSONB;
  old_evidence JSONB;
  old_provenance JSONB;
  old_installation_active BOOLEAN;
  old_verifier_active BOOLEAN;
  new_binding JSONB;
  new_evidence JSONB;
  new_provenance JSONB;
  new_installation_active BOOLEAN;
  new_verifier_active BOOLEAN;
  new_reason TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."epoch" <> 0 THEN RAISE EXCEPTION 'initial epoch must be zero'; END IF;
  ELSE
    IF NEW."scopeKey" <> OLD."scopeKey" OR NEW."epoch" <> OLD."epoch" + 1 THEN
      RAISE EXCEPTION 'authority epoch must advance exactly once';
    END IF;
    EXECUTE format(
      'SELECT b."binding", o."evidence", o."provenance", o."installationActive", o."verifierActive", o."reason" FROM %I.%I b JOIN %I.%I o ON o."scopeKey" = b."scopeKey" AND o."epoch" = b."epoch" WHERE b."scopeKey" = $1 AND b."epoch" = $2',
      TG_TABLE_SCHEMA,
      'SdkGrowthBindingVersion',
      TG_TABLE_SCHEMA,
      'SdkGrowthOwnerVersion'
    ) INTO new_binding, new_evidence, new_provenance, new_installation_active, new_verifier_active, new_reason
      USING NEW."scopeKey", NEW."epoch";
    IF new_reason IS NULL THEN
      RAISE EXCEPTION 'incomplete authority epoch';
    END IF;
    IF OLD."epoch" = 0 THEN
      IF new_reason <> 'provision' THEN
        RAISE EXCEPTION 'authority reason does not match transition';
      END IF;
    ELSE
      EXECUTE format(
        'SELECT b."binding", o."evidence", o."provenance", o."installationActive", o."verifierActive" FROM %I.%I b JOIN %I.%I o ON o."scopeKey" = b."scopeKey" AND o."epoch" = b."epoch" WHERE b."scopeKey" = $1 AND b."epoch" = $2',
        TG_TABLE_SCHEMA,
        'SdkGrowthBindingVersion',
        TG_TABLE_SCHEMA,
        'SdkGrowthOwnerVersion'
      ) INTO old_binding, old_evidence, old_provenance, old_installation_active, old_verifier_active
        USING OLD."scopeKey", OLD."epoch";
      IF old_binding IS NULL OR (CASE new_reason
        WHEN 'binding-replacement' THEN
          new_binding IS DISTINCT FROM old_binding
          AND new_evidence->'revoked' IS NOT DISTINCT FROM old_evidence->'revoked'
          AND new_installation_active IS NOT DISTINCT FROM old_installation_active
          AND new_verifier_active IS NOT DISTINCT FROM old_verifier_active
        WHEN 'owner-replacement' THEN
          new_binding IS NOT DISTINCT FROM old_binding
          AND (new_evidence IS DISTINCT FROM old_evidence OR new_provenance IS DISTINCT FROM old_provenance)
          AND new_evidence->'revoked' IS NOT DISTINCT FROM old_evidence->'revoked'
          AND new_installation_active IS NOT DISTINCT FROM old_installation_active
          AND new_verifier_active IS NOT DISTINCT FROM old_verifier_active
        WHEN 'owner-revocation' THEN
          new_binding IS NOT DISTINCT FROM old_binding
          AND old_evidence->'revoked' = 'false'::jsonb
          AND new_evidence = jsonb_set(old_evidence, '{revoked}', 'true'::jsonb, false)
          AND new_provenance IS NOT DISTINCT FROM old_provenance
          AND new_installation_active IS NOT DISTINCT FROM old_installation_active
          AND new_verifier_active IS NOT DISTINCT FROM old_verifier_active
        WHEN 'installation-invalidation' THEN
          new_binding IS NOT DISTINCT FROM old_binding
          AND new_evidence IS NOT DISTINCT FROM old_evidence
          AND new_provenance IS NOT DISTINCT FROM old_provenance
          AND old_installation_active AND NOT new_installation_active
          AND new_verifier_active IS NOT DISTINCT FROM old_verifier_active
        WHEN 'verifier-withdrawal' THEN
          new_binding IS NOT DISTINCT FROM old_binding
          AND new_evidence IS NOT DISTINCT FROM old_evidence
          AND new_provenance IS NOT DISTINCT FROM old_provenance
          AND new_installation_active IS NOT DISTINCT FROM old_installation_active
          AND old_verifier_active AND NOT new_verifier_active
        ELSE false
      END) IS NOT TRUE THEN
        RAISE EXCEPTION 'authority reason does not match transition';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sdk_current_advance BEFORE INSERT OR UPDATE ON "SdkGrowthCurrentAuthority" FOR EACH ROW EXECUTE FUNCTION sdk_growth_snapshot_advance();
