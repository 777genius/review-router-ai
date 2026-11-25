import { createHash } from "node:crypto";

const effectAuthorityRole = "reviewrouter_codex_effect_authority";
const authorityUrlKey = "REVIEW_ROUTER_CODEX_EFFECT_AUTHORITY_DATABASE_URL";

export type SelfHostedDatabasePlan = Readonly<{
  /** Sensitive psql input: pass on stdin, never in argv, logs or a receipt. */
  preMigrationSql: string;
  /** Includes a psql reconnect to verify the retained credential after migration. */
  postMigrationSql: string;
}>;

type DatabaseConfiguration = Readonly<{
  user: string;
  database: string;
  authorityPassword: string;
  binding: string;
}>;

function invalid(): never {
  // Connection strings and passwords must never appear in a diagnostic.
  throw new Error("self_hosted_database_configuration_invalid");
}

function readConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
): DatabaseConfiguration {
  const user = environment.POSTGRES_USER;
  const database = environment.POSTGRES_DB;
  const password = environment.POSTGRES_PASSWORD;
  const identifier = /^[a-z][a-z0-9_]{0,62}$/u;
  if (
    !user ||
    !identifier.test(user) ||
    user.startsWith("pg_") ||
    user.startsWith("reviewrouter_") ||
    !database ||
    !identifier.test(database) ||
    ["postgres", "template0", "template1"].includes(database) ||
    !password
  )
    invalid();

  const parse = (value: string | undefined): URL => {
    try {
      if (!value || value !== value.trim()) invalid();
      const url = new URL(value);
      if (
        !["postgres:", "postgresql:"].includes(url.protocol) ||
        url.hostname !== "postgres" ||
        (url.port || "5432") !== "5432" ||
        url.pathname !== `/${database}` ||
        url.hash ||
        [...url.searchParams].some(
          ([key, value]) => key !== "schema" || value !== "public",
        ) ||
        url.searchParams.getAll("schema").length > 1
      )
        invalid();
      return url;
    } catch {
      return invalid();
    }
  };
  const runtime = parse(environment.DATABASE_URL);
  const authority = parse(environment[authorityUrlKey]);
  let authorityPassword: string;
  try {
    authorityPassword = decodeURIComponent(authority.password);
    if (
      decodeURIComponent(runtime.username) !== user ||
      decodeURIComponent(runtime.password) !== password ||
      decodeURIComponent(authority.username) !== effectAuthorityRole
    )
      invalid();
  } catch {
    return invalid();
  }
  // The installer generates an independent, canonical base64url secret once.
  // This also makes the SQL and psql environment assignment non-interpolating.
  if (
    !/^[A-Za-z0-9_-]{43,128}$/u.test(authorityPassword) ||
    Buffer.from(authorityPassword, "base64url").toString("base64url") !==
      authorityPassword ||
    authorityPassword === password
  )
    invalid();
  return {
    user,
    database,
    authorityPassword,
    binding: createHash("sha256")
      .update(JSON.stringify([user, database, authorityPassword]))
      .digest("hex"),
  };
}

function administratorGuard({ user, database }: DatabaseConfiguration): string {
  return `
  IF current_user <> '${user}' OR session_user <> current_user
     OR current_database() <> '${database}'
     OR current_setting('server_version_num')::integer < 170000
     OR pg_catalog.pg_is_in_recovery()
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles
       WHERE rolname=current_user AND rolsuper)
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_database
       WHERE datname=current_database()
         AND datdba=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user))
  THEN RAISE EXCEPTION 'self_hosted_database_owner_required' USING ERRCODE='42501';
  END IF;`;
}

function roleGuard(configuration: DatabaseConfiguration): string {
  return `
  SELECT * INTO authority FROM pg_catalog.pg_authid
    WHERE rolname='${effectAuthorityRole}';
  IF NOT FOUND OR NOT authority.rolcanlogin OR authority.rolinherit
     OR authority.rolsuper OR authority.rolcreatedb OR authority.rolcreaterole
     OR authority.rolreplication OR authority.rolbypassrls
     OR authority.rolconnlimit <> -1 OR authority.rolvaliduntil IS NOT NULL
     OR authority.rolpassword IS NULL
     OR authority.rolpassword NOT LIKE 'SCRAM-SHA-256$%'
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_db_role_setting
       WHERE setrole=authority.oid)
     OR pg_catalog.has_schema_privilege(authority.oid, 'public', 'CREATE')
     OR pg_catalog.has_database_privilege(authority.oid, current_database(), 'CREATE')
     OR pg_catalog.shobj_description(authority.oid, 'pg_authid') IS DISTINCT FROM
       'reviewrouter-self-hosted-effect-authority:v1:${configuration.binding}:' ||
       (SELECT oid::text FROM pg_catalog.pg_database WHERE datname=current_database())
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members
       WHERE authority.oid IN (roleid, member, grantor))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_shdepend
       WHERE refclassid='pg_catalog.pg_authid'::regclass
         AND refobjid=authority.oid AND deptype='o')
  THEN RAISE EXCEPTION 'self_hosted_database_authority_role_invalid' USING ERRCODE='42501';
  END IF;`;
}

/**
 * Prepare the stock Compose database, not the separate SaaS release topology.
 * Migrations 79 and 110 explicitly support this standalone path. Creating a
 * release role here would select a different authority contract. Migration 64
 * owns the effect signer's grants, so the installer never repairs ACLs itself.
 *
 * Run preMigrationSql before the ordinary Compose migrate service, and
 * postMigrationSql afterwards, with psql -XqAt -v ON_ERROR_STOP=1. The caller
 * owns the isolated Compose project, saved 0600 environment and execution lock.
 */
export function buildSelfHostedDatabasePlan(
  environment: Readonly<Record<string, string | undefined>>,
): SelfHostedDatabasePlan {
  const configuration = readConfiguration(environment);
  const { database, authorityPassword, binding } = configuration;
  const header = `\\set ON_ERROR_STOP on
\\set VERBOSITY terse
\\set SHOW_CONTEXT never
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='30s';
`;

  const preMigrationSql = `${header}SET LOCAL password_encryption='scram-sha-256';
SET LOCAL log_statement='none';
SET LOCAL log_min_error_statement='panic';
SET LOCAL log_min_duration_statement=-1;
DO $self_hosted_install$
DECLARE authority pg_catalog.pg_authid%ROWTYPE;
BEGIN${administratorGuard(configuration)}
  PERFORM pg_catalog.pg_advisory_xact_lock(1381126735, 1397245001);
  IF pg_catalog.to_regrole('${effectAuthorityRole}') IS NULL THEN
    -- An interrupted run may resume its own role. It must not adopt an
    -- existing database or choose the SaaS release path on a shared cluster.
    IF pg_catalog.to_regrole('reviewrouter_release_migration') IS NOT NULL
       OR pg_catalog.to_regrole('reviewrouter_release_schema_owner') IS NOT NULL
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_namespace
         WHERE nspname <> 'public' AND nspname <> 'information_schema'
           AND nspname !~ '^pg_')
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c
         JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname='public')
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
         JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname='public')
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_type t
         JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace
         WHERE n.nspname='public')
    THEN RAISE EXCEPTION 'self_hosted_database_fresh_install_required' USING ERRCODE='42501';
    END IF;
    PERFORM pg_catalog.set_config('createrole_self_grant', '', true);
    CREATE ROLE ${effectAuthorityRole} LOGIN NOSUPERUSER NOCREATEDB
      NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT -1
      PASSWORD '${authorityPassword}';
    EXECUTE pg_catalog.format('COMMENT ON ROLE ${effectAuthorityRole} IS %L',
      'reviewrouter-self-hosted-effect-authority:v1:${binding}:' ||
      (SELECT oid::text FROM pg_catalog.pg_database WHERE datname=current_database()));
  END IF;${roleGuard(configuration)}
END $self_hosted_install$;
COMMIT;
SELECT 'self_hosted_database_role_prepared';
`;

  const postMigrationSql = `${header}DO $self_hosted_verify$
DECLARE authority pg_catalog.pg_authid%ROWTYPE;
BEGIN${administratorGuard(configuration)}${roleGuard(configuration)}
  IF pg_catalog.to_regprocedure('public.codex_oauth_sign_database_authority(text)') IS NULL
     OR pg_catalog.to_regclass('public."CodexOAuthDatabaseAuthorityKey"') IS NULL
     OR pg_catalog.to_regclass('public."CodexOAuthDatabaseAuthorityReceipt"') IS NULL
  THEN RAISE EXCEPTION 'self_hosted_database_authority_migration_missing' USING ERRCODE='42501';
  END IF;
  IF NOT pg_catalog.has_schema_privilege(authority.oid, 'public', 'USAGE')
     OR NOT pg_catalog.has_function_privilege(authority.oid,
       'public.codex_oauth_sign_database_authority(text)', 'EXECUTE')
     OR pg_catalog.has_table_privilege(authority.oid,
       'public."CodexOAuthDatabaseAuthorityKey"', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR pg_catalog.has_table_privilege(authority.oid,
       'public."CodexOAuthDatabaseAuthorityReceipt"', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR pg_catalog.has_any_column_privilege(authority.oid,
       'public."CodexOAuthDatabaseAuthorityKey"', 'SELECT,INSERT,UPDATE,REFERENCES')
     OR pg_catalog.has_any_column_privilege(authority.oid,
       'public."CodexOAuthDatabaseAuthorityReceipt"', 'SELECT,INSERT,UPDATE,REFERENCES')
  THEN RAISE EXCEPTION 'self_hosted_database_authority_grants_invalid' USING ERRCODE='42501';
  END IF;
END $self_hosted_verify$;
COMMIT;
-- A retained marker cannot prove the password still works. Authenticate using
-- the Compose network endpoint, with the secret only in this psql process.
\\setenv PGPASSWORD ${authorityPassword}
\\connect -reuse-previous=off 'host=postgres port=5432 dbname=${database} user=${effectAuthorityRole} connect_timeout=10'
\\setenv PGPASSWORD
DO $self_hosted_login$
BEGIN
  IF current_user <> '${effectAuthorityRole}' OR session_user <> current_user
     OR current_database() <> '${database}'
  THEN RAISE EXCEPTION 'self_hosted_database_authority_login_invalid' USING ERRCODE='42501';
  END IF;
END $self_hosted_login$;
SELECT 'self_hosted_database_role_ready';
`;
  return Object.freeze({ preMigrationSql, postMigrationSql });
}
