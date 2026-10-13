-- UPDATE(id) permits admission row locks, not C1 state/authority mutation.
-- SQL117/118 reject changed identities; API cannot write revision/ACK columns.
BEGIN;

DO $account_admission_api_acl$
DECLARE account_table text;
DECLARE account_column record;
BEGIN
  -- Fresh targets receive this same ACL from canonical role provisioning.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'reviewrouter_api') THEN
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'reviewrouter_api'
      AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls))
      OR pg_catalog.has_parameter_privilege('reviewrouter_api', 'session_replication_role', 'SET') THEN
      RAISE EXCEPTION 'account admission API role is privileged';
    END IF;
    FOREACH account_table IN ARRAY ARRAY['ProviderAccountConnection', 'WorkspaceAccountBinding'] LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_trigger guard
        WHERE guard.tgrelid = pg_catalog.to_regclass(pg_catalog.format('public.%I', account_table))
          AND guard.tgname = account_table || '_guard'
          AND NOT guard.tgisinternal AND guard.tgenabled IN ('O', 'A')
      ) OR pg_catalog.pg_has_role('reviewrouter_api', (
        SELECT relowner FROM pg_catalog.pg_class
        WHERE oid = pg_catalog.to_regclass(pg_catalog.format('public.%I', account_table))
      ), 'SET') THEN
        RAISE EXCEPTION 'account admission guard/owner authority is incompatible: %', account_table;
      END IF;
      EXECUTE pg_catalog.format('REVOKE ALL ON TABLE public.%I FROM reviewrouter_api', account_table);
      FOR account_column IN SELECT attname FROM pg_catalog.pg_attribute
        WHERE attrelid = pg_catalog.to_regclass(pg_catalog.format('public.%I', account_table))
          AND attnum > 0 AND NOT attisdropped
      LOOP
        EXECUTE pg_catalog.format('REVOKE ALL (%I) ON TABLE public.%I FROM reviewrouter_api', account_column.attname, account_table);
      END LOOP;
      EXECUTE pg_catalog.format('GRANT SELECT, UPDATE(id) ON TABLE public.%I TO reviewrouter_api', account_table);
      IF pg_catalog.has_table_privilege('reviewrouter_api', pg_catalog.format('public.%I', account_table), 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
          WHERE attrelid = pg_catalog.to_regclass(pg_catalog.format('public.%I', account_table))
            AND attnum > 0 AND NOT attisdropped
            AND (pg_catalog.has_column_privilege('reviewrouter_api', attrelid, attnum, 'INSERT,REFERENCES')
              OR (attname <> 'id' AND pg_catalog.has_column_privilege('reviewrouter_api', attrelid, attnum, 'UPDATE')))) THEN
        RAISE EXCEPTION 'account admission API has unexpected effective writes: %', account_table;
      END IF;
    END LOOP;
  END IF;
END
$account_admission_api_acl$;

COMMIT;
