-- C1 admission needs row locks without granting application account writes.
BEGIN;

DO $account_admission_lock_owner$
DECLARE observed record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'reviewrouter_account_admission_lock_owner'
  ) THEN
    EXECUTE 'CREATE ROLE reviewrouter_account_admission_lock_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS';
  END IF;
  SELECT * INTO observed FROM pg_catalog.pg_roles
  WHERE rolname = 'reviewrouter_account_admission_lock_owner';
  IF observed.rolcanlogin OR observed.rolinherit OR observed.rolsuper OR observed.rolcreatedb
     OR observed.rolcreaterole OR observed.rolreplication
     OR observed.rolbypassrls THEN
    RAISE EXCEPTION 'account admission lock owner role is incompatible';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members membership
    WHERE membership.roleid = observed.oid OR membership.member = observed.oid
  ) THEN
    RAISE EXCEPTION 'account admission lock owner must have no membership edges';
  END IF;
  -- The dedicated role must not bring an existing object authority into this
  -- new definer boundary. This numbered migration creates its sole routine.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_shdepend dependency
    WHERE dependency.refclassid = 'pg_catalog.pg_authid'::regclass
      AND dependency.refobjid = observed.oid AND dependency.deptype = 'o'
      AND (dependency.dbid = 0 OR dependency.dbid = (
        SELECT database.oid FROM pg_catalog.pg_database database
        WHERE database.datname = pg_catalog.current_database()
      ))
  ) THEN
    RAISE EXCEPTION 'account admission lock owner already owns objects';
  END IF;
END
$account_admission_lock_owner$;

CREATE FUNCTION public.reviewrouter_lock_account_admission(
  workspace text,
  connection text,
  binding text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  locked_connection text;
  locked_binding text;
  linked_connection text;
BEGIN
  IF workspace IS NULL OR pg_catalog.btrim(workspace) = ''
     OR connection IS NULL OR pg_catalog.btrim(connection) = ''
     OR binding IS NULL OR pg_catalog.btrim(binding) = '' THEN
    RETURN false;
  END IF;

  SELECT candidate.id INTO locked_connection
  FROM public."ProviderAccountConnection" AS candidate
  WHERE candidate.id = connection
    AND EXISTS (
      SELECT 1 FROM public."WorkspaceAccountBinding" AS bound
      WHERE bound.id = binding
        AND bound."workspaceId" = workspace
        AND bound."connectionId" = candidate.id
    )
  FOR UPDATE OF candidate;
  IF locked_connection IS NULL THEN
    RETURN false;
  END IF;

  SELECT candidate.id, candidate."connectionId"
  INTO locked_binding, linked_connection
  FROM public."WorkspaceAccountBinding" AS candidate
  WHERE candidate.id = binding
    AND candidate."workspaceId" = workspace
    AND candidate."connectionId" = connection
  FOR UPDATE OF candidate;
  IF locked_binding IS NULL OR linked_connection IS DISTINCT FROM connection THEN
    RETURN false;
  END IF;

  -- Recheck exact identity/linkage after both row locks are held.
  IF NOT EXISTS (
    SELECT 1
    FROM public."ProviderAccountConnection" AS account
    JOIN public."WorkspaceAccountBinding" AS bound
      ON bound."connectionId" = account.id
    WHERE account.id = connection
      AND bound.id = binding
      AND bound."workspaceId" = workspace
      AND bound."connectionId" = connection
  ) THEN
    RETURN false;
  END IF;
  RETURN true;
END
$function$;

ALTER FUNCTION public.reviewrouter_lock_account_admission(text, text, text)
  OWNER TO reviewrouter_account_admission_lock_owner;
REVOKE ALL ON FUNCTION public.reviewrouter_lock_account_admission(text, text, text)
  FROM PUBLIC;
-- Fresh databases may not have runtime roles until canonical provisioning.
-- Existing deployed databases converge this one privilege during migration.
DO $account_admission_lock_api_execute$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'reviewrouter_api') THEN
    GRANT EXECUTE ON FUNCTION public.reviewrouter_lock_account_admission(text, text, text)
      TO reviewrouter_api;
  END IF;
END
$account_admission_lock_api_execute$;

GRANT USAGE ON SCHEMA public TO reviewrouter_account_admission_lock_owner;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM reviewrouter_account_admission_lock_owner;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM reviewrouter_account_admission_lock_owner;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM reviewrouter_account_admission_lock_owner;
GRANT SELECT ON TABLE public."ProviderAccountConnection", public."WorkspaceAccountBinding"
  TO reviewrouter_account_admission_lock_owner;
GRANT UPDATE (id) ON TABLE public."ProviderAccountConnection"
  TO reviewrouter_account_admission_lock_owner;
GRANT UPDATE (id) ON TABLE public."WorkspaceAccountBinding"
  TO reviewrouter_account_admission_lock_owner;

DO $account_admission_lock_authority$
DECLARE routine record;
BEGIN
  SELECT pg_catalog.pg_get_userbyid(proowner) AS owner_name,
         prosecdef, proconfig
  INTO STRICT routine
  FROM pg_catalog.pg_proc
  WHERE oid = 'public.reviewrouter_lock_account_admission(text,text,text)'::regprocedure;
  IF routine.owner_name <> 'reviewrouter_account_admission_lock_owner'
     OR NOT routine.prosecdef
     OR routine.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog'] THEN
    RAISE EXCEPTION 'account admission lock function authority is incompatible';
  END IF;
  -- Table REVOKE does not erase old column ACLs. Reject stale column writes
  -- rather than silently accepting a broader owner than this helper needs.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute attribute
    WHERE attribute.attrelid IN (
      'public."ProviderAccountConnection"'::regclass,
      'public."WorkspaceAccountBinding"'::regclass
    ) AND attribute.attnum > 0 AND NOT attribute.attisdropped
      AND (
        pg_catalog.has_column_privilege('reviewrouter_account_admission_lock_owner',
          attribute.attrelid, attribute.attnum, 'INSERT')
        OR pg_catalog.has_column_privilege('reviewrouter_account_admission_lock_owner',
          attribute.attrelid, attribute.attnum, 'REFERENCES')
        OR (attribute.attname <> 'id' AND pg_catalog.has_column_privilege(
          'reviewrouter_account_admission_lock_owner', attribute.attrelid,
          attribute.attnum, 'UPDATE'))
      )
  ) THEN
    RAISE EXCEPTION 'account admission lock owner has unexpected column writes';
  END IF;
END
$account_admission_lock_authority$;

COMMIT;
