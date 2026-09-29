import { cpSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Only the disposable CI and self-hosted construction path uses this contract.
// PostgreSQL roles survive database creation. The first database reaches 110
// without the pair; subsequent databases see both roles from migration 1.
export const disposableBefore87 = "000087_codex_oauth_v4_v5_workflow_reattestation";

export function writeDisposableMigrationCatalog(phase, parent = tmpdir()) {
  if (!["before87", "pre79", "through79"].includes(phase))
    throw new Error("disposable_migration_catalog_phase_invalid");
  const upper = phase === "before87" ? disposableBefore87 : phase === "pre79" ? "000079_" : "000080_";
  const source = fileURLToPath(new URL("../../packages/platform/db/prisma/", import.meta.url));
  const root = mkdtempSync(join(parent, `rr-disposable-${phase}-`));
  const target = join(root, "prisma");
  cpSync(source, target, { recursive: true, filter: (path) => {
    const name = path.slice(source.length).replaceAll("\\", "/");
    const migration = name.match(/^migrations\/(\d{6}_[a-z0-9_]+)/u)?.[1];
    return !migration || migration < upper;
  }});
  const names = readdirSync(join(target, "migrations"))
    .filter((name) => /^\d{6}_[a-z0-9_]+$/u.test(name)).sort();
  if (names.some((name) => name >= upper) ||
      (phase === "before87" && (!names.includes("000079_hosted_codex_output_limits") ||
        !names.includes("000079_remove_account_wide_provider_lane_serialization") ||
        !names.includes("000086_comment_token_custody_r18_remediation"))) ||
      (phase === "pre79" && names.some((name) => name.startsWith("000079_"))) ||
      (phase === "through79" && (!names.includes("000079_hosted_codex_output_limits") ||
        !names.includes("000079_remove_account_wide_provider_lane_serialization")))) {
    throw new Error("disposable_migration_catalog_boundary_invalid");
  }
  const config = join(root, `${phase}.config.mjs`);
  writeFileSync(config, `export default { schema: ${JSON.stringify(join(target, "schema.prisma"))}, migrations: { path: ${JSON.stringify(join(target, "migrations"))} }, datasource: { url: process.env.DATABASE_URL } };\n`);
  return config;
}

const adminGuard = `current_user <> session_user OR NOT EXISTS
  (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND rolsuper)`;
// Roles are cluster-wide. Every handoff must reject a changed release pair,
// including SET-only membership, before touching database-local ownership.
const releasePairCatalogInvalid = `(SELECT count(*) FROM pg_catalog.pg_roles
    WHERE rolname IN ('reviewrouter_release_schema_owner',
      'reviewrouter_release_migration')) <> 2
  OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
    WHERE (r.rolname='reviewrouter_release_schema_owner'
      AND (r.rolcanlogin OR r.rolsuper OR NOT r.rolinherit OR r.rolcreatedb
        OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls
        OR r.rolconnlimit<>-1 OR r.rolvaliduntil IS NOT NULL))
      OR (r.rolname='reviewrouter_release_migration'
      AND (NOT r.rolcanlogin OR r.rolsuper OR r.rolinherit OR r.rolcreatedb
        OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls
        OR r.rolconnlimit<>-1 OR r.rolvaliduntil IS NOT NULL)))
  OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members e
    JOIN pg_catalog.pg_roles r ON r.oid IN (e.roleid,e.member,e.grantor)
    WHERE r.rolname IN ('reviewrouter_release_schema_owner',
      'reviewrouter_release_migration'))`;
const releaseDefinerOwnerCount = `(SELECT count(*) FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.proname IN ('codex_oauth_database_authority_challenge',
      'codex_oauth_sign_database_authority',
      'codex_oauth_runtime_referential_action_guard',
      'codex_oauth_provider_identity_transition',
      'codex_oauth_provider_identity_repair_challenge',
      'codex_oauth_provider_identity_guard',
      'codex_oauth_repair_quarantined_provider')
    AND pg_catalog.pg_get_userbyid(p.proowner)='reviewrouter_release_migration')`;

// PostgreSQL 17/18's fresh public schema has pg_database_owner=UC and
// PUBLIC=U. A fresh database has a null datacl (the built-in default).
// Inspect ACL entries as well as effective rights: membership and PUBLIC can
// otherwise make a role writable without a direct grant to that role.
const freshAclInvalid = `EXISTS (SELECT 1 FROM pg_catalog.pg_database d
    WHERE d.datname=pg_catalog.current_database() AND d.datacl IS NOT NULL)
  OR (SELECT count(*) FROM pg_catalog.pg_namespace n,
      LATERAL pg_catalog.aclexplode(n.nspacl) acl
      WHERE n.nspname='public') <> 3
  OR EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n,
      LATERAL pg_catalog.aclexplode(n.nspacl) acl
      WHERE n.nspname='public' AND (NOT (
        (acl.grantee='pg_database_owner'::regrole AND
          acl.privilege_type IN ('CREATE','USAGE')) OR
        (acl.grantee=0 AND acl.privilege_type='USAGE'))
        OR acl.grantor<>n.nspowner OR acl.is_grantable))
  OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
      WHERE NOT r.rolsuper AND r.rolname <> 'pg_database_owner'
        AND (pg_catalog.has_schema_privilege(r.oid,'public','CREATE')
          OR pg_catalog.has_database_privilege(r.oid,
            pg_catalog.current_database(),'CREATE')))`;

const protectedWriteInvalid = `EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
    CROSS JOIN (VALUES
      ('ReviewProviderScopeConcurrencyControl'), ('HostedCodexRuntimeGate'),
      ('HostedCodexRuntimeClosure'),
      ('HostedHistoricalScopePolicy'), ('HostedHistoricalUnknownScope'),
      ('HostedHistoricalScopeAlias'), ('HostedHistoricalScopeComplete')) AS protected(name)
    CROSS JOIN LATERAL (SELECT pg_catalog.to_regclass(
      pg_catalog.format('public.%I',protected.name)) AS oid) relation
    WHERE r.rolname IN ('reviewrouter_release_migration',
      'reviewrouter_api','reviewrouter_web','reviewrouter_worker',
      'reviewrouter_comment_token_custody','reviewrouter_codex_effect_authority',
      'reviewrouter_certified_fork_owner','reviewrouter_certified_fork_fact_owner',
      'reviewrouter_certified_fork_writer','reviewrouter_certified_fork_reader')
      AND relation.oid IS NOT NULL
      AND (pg_catalog.has_table_privilege(r.oid,
        relation.oid,'INSERT,UPDATE,DELETE,TRUNCATE')
        OR pg_catalog.has_any_column_privilege(r.oid,
          relation.oid,'INSERT,UPDATE,REFERENCES')))`;

// Stock grants the canonical NOLOGIN owner its bounded 110 dependencies.
// Any other explicit write grantee on these fixed protected relations is
// contamination, including a grant to PUBLIC or an otherwise unknown role.
const protectedAclInvalid = `EXISTS (SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) acl
    WHERE n.nspname='public' AND c.relname IN
      ('ReviewProviderScopeConcurrencyControl','HostedCodexRuntimeGate',
       'HostedCodexRuntimeClosure',
       'HostedHistoricalScopePolicy','HostedHistoricalUnknownScope',
       'HostedHistoricalScopeAlias','HostedHistoricalScopeComplete')
      AND acl.privilege_type IN
        ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')
      AND (acl.grantee NOT IN
        (c.relowner,'reviewrouter_release_schema_owner'::regrole)
        OR (acl.is_grantable AND acl.grantee<>c.relowner)))
  OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
    CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) acl
    WHERE n.nspname='public' AND c.relname IN
      ('ReviewProviderScopeConcurrencyControl','HostedCodexRuntimeGate',
       'HostedCodexRuntimeClosure',
       'HostedHistoricalScopePolicy','HostedHistoricalUnknownScope',
       'HostedHistoricalScopeAlias','HostedHistoricalScopeComplete')
      AND a.attnum>0 AND NOT a.attisdropped
      AND acl.privilege_type IN ('INSERT','UPDATE','REFERENCES')
      AND (acl.grantee NOT IN
        (c.relowner,'reviewrouter_release_schema_owner'::regrole)
        OR (acl.is_grantable AND acl.grantee<>c.relowner)))`;

// 110 gives the NOLOGIN owner SELECT on the historical projection. Its UPDATE
// dependency is confined to the runtime gate and two existing authority rows.
const historicalOwnerWriteInvalid = `EXISTS (SELECT 1 FROM (VALUES
    ('HostedHistoricalScopePolicy'),('HostedHistoricalUnknownScope'),
    ('HostedHistoricalScopeAlias'),('HostedHistoricalScopeComplete')) AS historical(name)
    CROSS JOIN LATERAL (SELECT pg_catalog.to_regclass(
      pg_catalog.format('public.%I',historical.name)) AS oid) relation
    WHERE relation.oid IS NOT NULL AND
      (pg_catalog.has_table_privilege('reviewrouter_release_schema_owner',
        relation.oid,'INSERT,UPDATE,DELETE,TRUNCATE') OR
       pg_catalog.has_any_column_privilege('reviewrouter_release_schema_owner',
        relation.oid,'INSERT,UPDATE,REFERENCES')))`;

// The 110 helpers use FOR SHARE, which requires the canonical owner to retain
// UPDATE as well as SELECT on the three lock targets. Projection reads and
// nested helper calls are separate, bounded dependencies.
const historicalOwnerDependencyInvalid = `EXISTS (SELECT 1 FROM (VALUES
    ('HostedCodexRuntimeGate',true),('ReviewRequestedIntent',true),
    ('RepositoryConnection',true),('HostedHistoricalScopePolicy',false),
    ('HostedHistoricalUnknownScope',false),('HostedHistoricalScopeAlias',false),
    ('HostedHistoricalScopeComplete',false)) AS dependency(name,needs_update)
    CROSS JOIN LATERAL (SELECT pg_catalog.to_regclass(
      pg_catalog.format('public.%I',dependency.name)) AS oid) relation
    WHERE relation.oid IS NULL
      OR NOT pg_catalog.has_table_privilege('reviewrouter_release_schema_owner',
        relation.oid,'SELECT')
      OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c,
        LATERAL pg_catalog.aclexplode(c.relacl) acl
        WHERE c.oid=relation.oid
          AND acl.grantee='reviewrouter_release_schema_owner'::regrole
          AND acl.grantor=c.relowner AND NOT acl.is_grantable
          AND acl.privilege_type='SELECT')
      OR (dependency.needs_update AND NOT pg_catalog.has_table_privilege(
        'reviewrouter_release_schema_owner',relation.oid,'UPDATE'))
      OR (dependency.needs_update AND NOT EXISTS
        (SELECT 1 FROM pg_catalog.pg_class c,
          LATERAL pg_catalog.aclexplode(c.relacl) acl
          WHERE c.oid=relation.oid
            AND acl.grantee='reviewrouter_release_schema_owner'::regrole
            AND acl.grantor=c.relowner AND NOT acl.is_grantable
            AND acl.privilege_type='UPDATE')))
  OR NOT pg_catalog.has_function_privilege('reviewrouter_release_schema_owner',
    'public.hosted_historical_set_digest()','EXECUTE')
  OR NOT pg_catalog.has_function_privilege('reviewrouter_release_schema_owner',
    'public.hosted_historical_assert_ready()','EXECUTE')
  OR NOT pg_catalog.has_function_privilege('reviewrouter_release_schema_owner',
    'public.hosted_historical_assert_grant(public."HostedCodexInvocationGrant")','EXECUTE')`;

const historicalDependencyFunctionAclInvalid = `(SELECT count(*) FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.oid IN
      (pg_catalog.to_regprocedure('public.hosted_historical_set_digest()'),
       pg_catalog.to_regprocedure('public.hosted_historical_assert_ready()'),
       pg_catalog.to_regprocedure(
         'public.hosted_historical_assert_grant(public."HostedCodexInvocationGrant")'))) <> 3
  OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.oid IN
      (pg_catalog.to_regprocedure('public.hosted_historical_set_digest()'),
       pg_catalog.to_regprocedure('public.hosted_historical_assert_ready()'),
       pg_catalog.to_regprocedure(
         'public.hosted_historical_assert_grant(public."HostedCodexInvocationGrant")'))
      AND (NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(p.proacl) acl
        WHERE acl.grantee='reviewrouter_release_schema_owner'::regrole
          AND acl.privilege_type='EXECUTE' AND NOT acl.is_grantable)
        OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(p.proacl) acl
          WHERE acl.privilege_type='EXECUTE' AND
            (NOT coalesce((acl.grantee=p.proowner OR
              acl.grantee='reviewrouter_release_schema_owner'::regrole OR
              acl.grantee=pg_catalog.to_regrole('reviewrouter_api') OR
              acl.grantee=pg_catalog.to_regrole('reviewrouter_web') OR
              acl.grantee=pg_catalog.to_regrole('reviewrouter_worker') OR
              acl.grantee=pg_catalog.to_regrole('reviewrouter_comment_token_custody')),false)
             OR (acl.is_grantable AND acl.grantee<>p.proowner)))))
  OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
    CROSS JOIN (VALUES
      ('public.hosted_historical_set_digest()'),
      ('public.hosted_historical_assert_ready()'),
      ('public.hosted_historical_assert_grant(public."HostedCodexInvocationGrant")')) AS f(signature)
    WHERE r.rolname IN ('reviewrouter_release_migration',
      'reviewrouter_codex_effect_authority','reviewrouter_certified_fork_owner',
      'reviewrouter_certified_fork_fact_owner','reviewrouter_certified_fork_writer',
      'reviewrouter_certified_fork_reader')
      AND pg_catalog.has_function_privilege(r.oid,f.signature,'EXECUTE'))`;

const providerFunctionsInvalid = `EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN (
      'reviewrouter_provider_scope_concurrency_snapshot',
      'reviewrouter_provider_scope_concurrency_status',
      'reviewrouter_provider_scope_concurrency_activate',
      'reviewrouter_provider_scope_concurrency_close_for_rollback',
      'reviewrouter_provider_scope_concurrency_verify_rollback')
      AND (p.pronargs<>0 OR pg_catalog.pg_get_userbyid(p.proowner)<>'reviewrouter_release_schema_owner'
        OR NOT p.prosecdef OR (p.proconfig @> ARRAY['search_path=pg_catalog, public']) IS DISTINCT FROM TRUE
        OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(p.proacl) acl
          WHERE acl.privilege_type='EXECUTE' AND
            (acl.is_grantable AND acl.grantee<>'reviewrouter_release_schema_owner'::regrole
             OR acl.grantee NOT IN
            ('reviewrouter_release_schema_owner'::regrole,
             'reviewrouter_release_migration'::regrole)))
        OR pg_catalog.has_function_privilege('reviewrouter_release_migration',
          p.oid,'EXECUTE') <> (p.proname <> 'reviewrouter_provider_scope_concurrency_snapshot')))
  OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
    JOIN pg_catalog.pg_proc p ON p.proname IN (
      'reviewrouter_provider_scope_concurrency_snapshot',
      'reviewrouter_provider_scope_concurrency_status',
      'reviewrouter_provider_scope_concurrency_activate',
      'reviewrouter_provider_scope_concurrency_close_for_rollback',
      'reviewrouter_provider_scope_concurrency_verify_rollback')
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace AND n.nspname='public'
    WHERE r.rolname IN ('reviewrouter_api','reviewrouter_web','reviewrouter_worker',
      'reviewrouter_comment_token_custody','reviewrouter_codex_effect_authority',
      'reviewrouter_certified_fork_owner','reviewrouter_certified_fork_fact_owner',
      'reviewrouter_certified_fork_writer','reviewrouter_certified_fork_reader')
      AND pg_catalog.has_function_privilege(r.oid,p.oid,'EXECUTE'))`;

const historicalDefinersInvalid = `EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN
      ('hosted_historical_lock_runtime_gate','hosted_historical_grant_guard')
      AND (p.pronargs<>0 OR pg_catalog.pg_get_userbyid(p.proowner)<>'reviewrouter_release_schema_owner'
        OR NOT p.prosecdef OR (p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp']) IS DISTINCT FROM TRUE
        OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(p.proacl) acl
          WHERE acl.privilege_type='EXECUTE' AND
            (acl.is_grantable AND acl.grantee<>'reviewrouter_release_schema_owner'::regrole
             OR NOT coalesce((acl.grantee=
              'reviewrouter_release_schema_owner'::regrole OR
              (p.proname='hosted_historical_lock_runtime_gate' AND
               acl.grantee=pg_catalog.to_regrole('reviewrouter_api'))),false)))
        OR pg_catalog.has_function_privilege('reviewrouter_release_migration',
          p.oid,'EXECUTE')))
  OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
    JOIN pg_catalog.pg_proc p ON p.proname IN
      ('hosted_historical_lock_runtime_gate','hosted_historical_grant_guard')
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace AND n.nspname='public'
    WHERE r.rolname IN ('reviewrouter_api','reviewrouter_web','reviewrouter_worker',
      'reviewrouter_comment_token_custody','reviewrouter_codex_effect_authority',
      'reviewrouter_certified_fork_owner','reviewrouter_certified_fork_fact_owner',
      'reviewrouter_certified_fork_writer','reviewrouter_certified_fork_reader')
      AND pg_catalog.has_function_privilege(r.oid,p.oid,'EXECUTE') <>
        (r.rolname='reviewrouter_api' AND
         p.proname='hosted_historical_lock_runtime_gate'))`;

// Run on each fresh target before role creation or migration. This rejects
// inherited/PUBLIC/default authority and dirty databases before any write.
export const disposableFreshDatabasePreflightSql = `DO $fresh$
BEGIN
  IF ${adminGuard}
     OR pg_catalog.current_database() = 'postgres'
     OR (SELECT pg_catalog.pg_get_userbyid(datdba) FROM pg_catalog.pg_database
           WHERE datname=pg_catalog.current_database()) <> current_user
     OR NOT pg_catalog.has_schema_privilege(current_user,'public','CREATE')
     OR (SELECT pg_catalog.pg_get_userbyid(nspowner) FROM pg_catalog.pg_namespace
           WHERE nspname='public') <> 'pg_database_owner'
     OR pg_catalog.has_database_privilege('reviewrouter_release_schema_owner',
           pg_catalog.current_database(),'CREATE')
     OR ${freshAclInvalid}
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_database d
           CROSS JOIN LATERAL pg_catalog.aclexplode(d.datacl) acl
           WHERE d.datname=pg_catalog.current_database()
             AND ((acl.grantee=0 AND acl.privilege_type='CREATE')
               OR acl.grantee='reviewrouter_release_schema_owner'::regrole))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n
                ON n.oid=c.relnamespace WHERE n.nspname='public')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n
                ON n.oid=p.pronamespace WHERE n.nspname='public')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n
                ON n.oid=t.typnamespace WHERE n.nspname='public')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n
                WHERE n.nspname NOT IN ('public','pg_catalog','information_schema','pg_toast'))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_default_acl)
     OR (SELECT count(*) FROM pg_catalog.pg_roles
           WHERE rolname IN ('reviewrouter_certified_fork_owner',
             'reviewrouter_certified_fork_fact_owner',
             'reviewrouter_certified_fork_writer',
             'reviewrouter_certified_fork_reader')) <> 4
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
           WHERE r.rolname LIKE 'reviewrouter_certified_fork_%'
             AND (r.rolname NOT IN ('reviewrouter_certified_fork_owner',
               'reviewrouter_certified_fork_fact_owner',
               'reviewrouter_certified_fork_writer',
               'reviewrouter_certified_fork_reader')
               OR r.rolcanlogin OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole
               OR r.rolinherit OR r.rolreplication OR r.rolbypassrls
               OR r.rolconnlimit<>-1 OR r.rolvaliduntil IS NOT NULL))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles r JOIN pg_catalog.pg_auth_members e
           ON r.oid IN (e.roleid,e.member,e.grantor)
           WHERE r.rolname LIKE 'reviewrouter_certified_fork_%')
     OR pg_catalog.has_schema_privilege('reviewrouter_release_schema_owner','public','CREATE')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n
                CROSS JOIN LATERAL pg_catalog.aclexplode(n.nspacl) acl
                WHERE n.nspname='public' AND acl.privilege_type='CREATE'
                  AND acl.grantee=0)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n
                CROSS JOIN LATERAL pg_catalog.aclexplode(n.nspacl) acl
                JOIN pg_catalog.pg_roles r ON r.oid=acl.grantee
                WHERE n.nspname='public' AND r.rolname IN
                  ('reviewrouter_release_schema_owner','reviewrouter_release_migration'))
  THEN RAISE EXCEPTION 'disposable_fresh_database_catalog_invalid' USING ERRCODE='42501';
  END IF;
END $fresh$;\n`;

// The stock 64/66 functions and both 79 directories run before this handoff.
// 87 requires precisely the public schema and namespace table to be canonical.
export const disposableBefore87HandoffSql = `BEGIN;
DO $handoff$
BEGIN
  IF ${adminGuard}
     OR ${releasePairCatalogInvalid}
     OR NOT EXISTS (SELECT 1 FROM public._prisma_migrations
       WHERE migration_name='000086_comment_token_custody_r18_remediation'
         AND finished_at IS NOT NULL AND rolled_back_at IS NULL)
     OR EXISTS (SELECT 1 FROM public._prisma_migrations
       WHERE migration_name >= '000087_')
     OR (SELECT pg_catalog.pg_get_userbyid(nspowner) FROM pg_catalog.pg_namespace
         WHERE nspname='public') NOT IN (current_user,'pg_database_owner')
     OR (SELECT pg_catalog.pg_get_userbyid(relowner) FROM pg_catalog.pg_class
         WHERE oid='public."CodexOAuthSecretNamespace"'::regclass) <> current_user
     OR pg_catalog.has_schema_privilege('reviewrouter_release_schema_owner','public','CREATE')
     OR pg_catalog.has_schema_privilege('reviewrouter_release_migration','public','CREATE')
     OR pg_catalog.has_table_privilege('reviewrouter_release_migration',
          'public."ReviewProviderScopeConcurrencyControl"','UPDATE')
     OR pg_catalog.has_any_column_privilege('reviewrouter_release_migration',
          'public."ReviewProviderScopeConcurrencyControl"','UPDATE')
     OR ${releaseDefinerOwnerCount} <> 7
     OR (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n
         ON n.oid=p.pronamespace WHERE n.nspname='public'
         AND p.proname IN ('reviewrouter_provider_scope_concurrency_snapshot',
           'reviewrouter_provider_scope_concurrency_status',
           'reviewrouter_provider_scope_concurrency_activate',
           'reviewrouter_provider_scope_concurrency_close_for_rollback',
           'reviewrouter_provider_scope_concurrency_verify_rollback')
         AND pg_catalog.pg_get_userbyid(p.proowner)='reviewrouter_release_schema_owner') <> 5
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n
         CROSS JOIN LATERAL pg_catalog.aclexplode(n.nspacl) acl
         WHERE n.nspname='public' AND acl.grantee=0 AND acl.privilege_type='CREATE')
  THEN RAISE EXCEPTION 'disposable_before87_handoff_invalid' USING ERRCODE='42501';
  END IF;
END $handoff$;
ALTER SCHEMA public OWNER TO reviewrouter_release_schema_owner;
ALTER TABLE public."CodexOAuthSecretNamespace" OWNER TO reviewrouter_release_schema_owner;
GRANT USAGE ON SCHEMA public TO reviewrouter_release_migration;
COMMIT;\n`;

export const disposableFullChainVerificationSql = `DO $verify$
BEGIN
  IF ${adminGuard}
     OR ${releasePairCatalogInvalid}
     OR (SELECT pg_catalog.pg_get_userbyid(nspowner) FROM pg_catalog.pg_namespace
         WHERE nspname='public') <> 'reviewrouter_release_schema_owner'
     OR (SELECT pg_catalog.pg_get_userbyid(relowner) FROM pg_catalog.pg_class
         WHERE oid='public."CodexOAuthSecretNamespace"'::regclass) <> 'reviewrouter_release_schema_owner'
     OR (SELECT pg_catalog.pg_get_userbyid(relowner) FROM pg_catalog.pg_class
         WHERE oid='public."CodexOAuthWorkflowCompatibility"'::regclass) <> 'reviewrouter_release_schema_owner'
     OR NOT pg_catalog.has_schema_privilege('reviewrouter_release_schema_owner','public','USAGE')
     OR NOT pg_catalog.has_schema_privilege('reviewrouter_release_migration','public','USAGE')
     OR pg_catalog.has_schema_privilege('reviewrouter_release_migration','public','CREATE')
     OR pg_catalog.has_table_privilege('reviewrouter_release_migration',
         'public."ReviewProviderScopeConcurrencyControl"','UPDATE')
     OR pg_catalog.has_any_column_privilege('reviewrouter_release_migration',
         'public."ReviewProviderScopeConcurrencyControl"','UPDATE')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
         WHERE r.rolname IN ('reviewrouter_api','reviewrouter_web','reviewrouter_worker')
           AND (pg_catalog.has_table_privilege(r.rolname,
             'public."ReviewProviderScopeConcurrencyControl"','UPDATE')
             OR pg_catalog.has_any_column_privilege(r.rolname,
               'public."ReviewProviderScopeConcurrencyControl"','UPDATE')))
     OR pg_catalog.has_table_privilege('reviewrouter_release_migration',
         'public."HostedHistoricalScopePolicy"','UPDATE')
     OR ${protectedWriteInvalid}
     OR ${protectedAclInvalid}
     OR ${historicalOwnerWriteInvalid}
     OR ${historicalOwnerDependencyInvalid}
     OR ${historicalDependencyFunctionAclInvalid}
     OR pg_catalog.to_regclass('public."HostedCodexRuntimeClosure"') IS NULL
     OR ${providerFunctionsInvalid}
     OR (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n
         ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN
         ('hosted_historical_lock_runtime_gate','hosted_historical_grant_guard')) <> 2
     OR ${historicalDefinersInvalid}
     OR ${releaseDefinerOwnerCount} <> 7
     OR (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n
         ON n.oid=p.pronamespace WHERE n.nspname='public'
         AND p.proname IN ('reviewrouter_provider_scope_concurrency_snapshot',
           'reviewrouter_provider_scope_concurrency_status',
           'reviewrouter_provider_scope_concurrency_activate',
           'reviewrouter_provider_scope_concurrency_close_for_rollback',
           'reviewrouter_provider_scope_concurrency_verify_rollback')
         AND pg_catalog.pg_get_userbyid(p.proowner)='reviewrouter_release_schema_owner') <> 5
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
         WHERE r.rolname LIKE 'reviewrouter_certified_fork_%'
           AND (r.rolcanlogin OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole
                OR r.rolinherit OR r.rolreplication OR r.rolbypassrls
                OR r.rolconnlimit<>-1 OR r.rolvaliduntil IS NOT NULL))
     OR (SELECT count(*) FROM pg_catalog.pg_roles
         WHERE rolname IN ('reviewrouter_certified_fork_owner',
           'reviewrouter_certified_fork_fact_owner',
           'reviewrouter_certified_fork_writer',
           'reviewrouter_certified_fork_reader')) <> 4
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles r JOIN pg_catalog.pg_auth_members e
         ON r.oid IN (e.roleid,e.member,e.grantor)
         WHERE r.rolname LIKE 'reviewrouter_certified_fork_%')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles
         WHERE rolname IN ('reviewrouter_certified_fork_creator',
           'reviewrouter_certified_fork_fact_creator'))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n
         ON n.oid=p.pronamespace WHERE n.nspname='public'
           AND p.proname IN ('codex_oauth_v4_v5_reattestation_transition',
             'codex_oauth_secret_namespace_tombstone_guard',
             'codex_oauth_reattest_active_namespace_v4_to_v5',
             'codex_oauth_workflow_compatibility_guard')
           AND pg_catalog.pg_get_userbyid(p.proowner)<>'reviewrouter_release_schema_owner')
     OR (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n
         ON n.oid=p.pronamespace WHERE n.nspname='public'
           AND p.proname IN ('codex_oauth_v4_v5_reattestation_transition',
             'codex_oauth_secret_namespace_tombstone_guard',
             'codex_oauth_reattest_active_namespace_v4_to_v5',
             'codex_oauth_workflow_compatibility_guard')) <> 4
  THEN RAISE EXCEPTION 'disposable_full_chain_verification_failed' USING ERRCODE='42501';
  END IF;
END $verify$;\n`;

// CI and Compose use the construction verifier above: those standalone
// administrators do not claim a named runtime identity matrix. The real PG17
// regression provisions all five restricted identities and adds this gate.
// Missing names must fail before the effective-ACL loops can become empty.
export function disposableRuntimeIdentityVerificationSql(phase) {
  if (!['full110', 'provider79'].includes(phase))
    throw new Error('disposable_runtime_identity_phase_invalid');
  return `DO $runtime$
BEGIN
  IF ${adminGuard}
     OR (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN
       ('reviewrouter_api','reviewrouter_web','reviewrouter_worker',
        'reviewrouter_comment_token_custody','reviewrouter_codex_effect_authority')) <> 5
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN
       ('reviewrouter_api','reviewrouter_web','reviewrouter_worker',
       'reviewrouter_comment_token_custody','reviewrouter_codex_effect_authority')
       AND (NOT rolcanlogin OR NOT rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole
         OR rolreplication OR rolbypassrls OR rolconnlimit<>-1
         OR rolvaliduntil IS NOT NULL))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
       JOIN pg_catalog.pg_auth_members e ON r.oid IN (e.roleid,e.member,e.grantor)
       WHERE r.rolname IN ('reviewrouter_api','reviewrouter_web','reviewrouter_worker',
         'reviewrouter_comment_token_custody','reviewrouter_codex_effect_authority'))
  THEN RAISE EXCEPTION 'disposable_${phase}_runtime_identity_invalid' USING ERRCODE='42501';
  END IF;
END $runtime$;\n`;
}

export function disposableRuntimeQualifiedVerificationSql(phase) {
  const identity = disposableRuntimeIdentityVerificationSql(phase);
  return identity + (phase === 'full110'
    ? disposableFullChainVerificationSql : disposableProvider79VerificationSql);
}

// The provider fixture deliberately stops at 79. Its canonical owner needs
// CREATE on public to restore the reversible lease index; this is authorized
// only after the exact two relation handoffs in the disposable provider DB.
export const disposableProvider79HandoffSql = `BEGIN;
DO $handoff$
BEGIN
  IF ${adminGuard}
     OR ${releasePairCatalogInvalid}
     OR (SELECT count(*) FROM public._prisma_migrations
         WHERE migration_name LIKE '000079_%' AND finished_at IS NOT NULL
           AND rolled_back_at IS NULL) <> 2
     OR (SELECT pg_catalog.pg_get_userbyid(relowner) FROM pg_catalog.pg_class
         WHERE oid='public."ReviewProviderScopeConcurrencyControl"'::regclass) <> current_user
     OR (SELECT pg_catalog.pg_get_userbyid(relowner) FROM pg_catalog.pg_class
         WHERE oid='public."ReviewInvocationLeaseV2"'::regclass) <> current_user
     OR pg_catalog.has_schema_privilege('reviewrouter_release_schema_owner','public','CREATE')
     OR pg_catalog.has_schema_privilege('reviewrouter_release_migration','public','CREATE')
     OR pg_catalog.has_table_privilege('reviewrouter_release_migration',
         'public."ReviewProviderScopeConcurrencyControl"','UPDATE')
     OR pg_catalog.has_any_column_privilege('reviewrouter_release_migration',
         'public."ReviewProviderScopeConcurrencyControl"','UPDATE')
     OR (SELECT count(*) FROM pg_catalog.pg_proc p
         JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname='public' AND p.proname IN
           ('reviewrouter_provider_scope_concurrency_snapshot',
            'reviewrouter_provider_scope_concurrency_status',
            'reviewrouter_provider_scope_concurrency_activate',
            'reviewrouter_provider_scope_concurrency_close_for_rollback',
            'reviewrouter_provider_scope_concurrency_verify_rollback')
           AND pg_catalog.pg_get_userbyid(p.proowner)='reviewrouter_release_schema_owner') <> 5
  THEN RAISE EXCEPTION 'disposable_provider79_handoff_invalid' USING ERRCODE='42501';
  END IF;
END $handoff$;
ALTER TABLE public."ReviewProviderScopeConcurrencyControl"
  OWNER TO reviewrouter_release_schema_owner;
ALTER TABLE public."ReviewInvocationLeaseV2"
  OWNER TO reviewrouter_release_schema_owner;
GRANT USAGE ON SCHEMA public TO reviewrouter_release_migration;
GRANT USAGE, CREATE ON SCHEMA public TO reviewrouter_release_schema_owner;
COMMIT;\n`;

export const disposableProvider79VerificationSql = `DO $verify$
BEGIN
  IF ${adminGuard}
     OR ${releasePairCatalogInvalid}
     OR (SELECT count(*) FROM public._prisma_migrations
         WHERE migration_name LIKE '000079_%' AND finished_at IS NOT NULL) <> 2
     OR (SELECT pg_catalog.pg_get_userbyid(relowner) FROM pg_catalog.pg_class
         WHERE oid='public."ReviewProviderScopeConcurrencyControl"'::regclass)
           <> 'reviewrouter_release_schema_owner'
     OR (SELECT pg_catalog.pg_get_userbyid(relowner) FROM pg_catalog.pg_class
         WHERE oid='public."ReviewInvocationLeaseV2"'::regclass)
           <> 'reviewrouter_release_schema_owner'
     OR NOT pg_catalog.has_schema_privilege('reviewrouter_release_schema_owner','public','CREATE')
     OR NOT pg_catalog.has_schema_privilege('reviewrouter_release_migration','public','USAGE')
     OR pg_catalog.has_schema_privilege('reviewrouter_release_migration','public','CREATE')
     OR pg_catalog.has_table_privilege('reviewrouter_release_migration',
         'public."ReviewProviderScopeConcurrencyControl"','UPDATE')
     OR pg_catalog.has_any_column_privilege('reviewrouter_release_migration',
         'public."ReviewProviderScopeConcurrencyControl"','UPDATE')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
         WHERE r.rolname IN ('reviewrouter_api','reviewrouter_web','reviewrouter_worker')
           AND (pg_catalog.has_table_privilege(r.rolname,
             'public."ReviewProviderScopeConcurrencyControl"','UPDATE')
             OR pg_catalog.has_any_column_privilege(r.rolname,
               'public."ReviewProviderScopeConcurrencyControl"','UPDATE')))
     OR NOT pg_catalog.has_function_privilege('reviewrouter_release_migration',
         'public.reviewrouter_provider_scope_concurrency_status()','EXECUTE')
     OR ${protectedWriteInvalid}
     OR ${protectedAclInvalid}
     OR ${historicalOwnerWriteInvalid}
     OR ${providerFunctionsInvalid}
     OR (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n
         ON n.oid=p.pronamespace WHERE n.nspname='public'
         AND p.proname IN ('reviewrouter_provider_scope_concurrency_snapshot',
           'reviewrouter_provider_scope_concurrency_status',
           'reviewrouter_provider_scope_concurrency_activate',
           'reviewrouter_provider_scope_concurrency_close_for_rollback',
           'reviewrouter_provider_scope_concurrency_verify_rollback')
         AND pg_catalog.pg_get_userbyid(p.proowner)='reviewrouter_release_schema_owner') <> 5
  THEN RAISE EXCEPTION 'disposable_provider79_verification_failed' USING ERRCODE='42501';
  END IF;
END $verify$;\n`;
export function disposableReleaseMigrationRoleSql(password) {
  if (!/^[A-Za-z0-9_-]{32,}$/u.test(password)) {
    throw new Error("self_hosted_release_role_password_invalid");
  }
  return `DO $disposable_release_role$
DECLARE owner_role pg_catalog.pg_roles%ROWTYPE;
BEGIN
  IF pg_catalog.current_database() <> 'postgres'
     OR current_user <> session_user
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles
                    WHERE rolname = current_user AND rolsuper) THEN
    RAISE EXCEPTION 'self_hosted_release_role_admin_required';
  END IF;
  SELECT * INTO owner_role FROM pg_catalog.pg_roles
    WHERE rolname = 'reviewrouter_release_schema_owner';
  IF NOT FOUND OR owner_role.rolcanlogin OR owner_role.rolsuper
     OR NOT owner_role.rolinherit
     OR owner_role.rolcreatedb OR owner_role.rolcreaterole
     OR owner_role.rolreplication OR owner_role.rolbypassrls
     OR owner_role.rolconnlimit <> -1 OR owner_role.rolvaliduntil IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members edge
                WHERE edge.roleid = owner_role.oid OR edge.member = owner_role.oid
                   OR edge.grantor = owner_role.oid) THEN
    RAISE EXCEPTION 'self_hosted_release_schema_owner_invalid';
  END IF;
  IF pg_catalog.to_regrole('reviewrouter_release_migration') IS NOT NULL THEN
    RAISE EXCEPTION 'self_hosted_release_role_already_present';
  END IF;
  PERFORM pg_catalog.set_config('createrole_self_grant', '', true);
  CREATE ROLE reviewrouter_release_migration LOGIN NOSUPERUSER NOCREATEDB
    NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS
    PASSWORD '${password}';
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members edge
             WHERE edge.roleid = 'reviewrouter_release_migration'::regrole
                OR edge.member = 'reviewrouter_release_migration'::regrole
                OR edge.grantor = 'reviewrouter_release_migration'::regrole) THEN
    RAISE EXCEPTION 'self_hosted_release_role_membership_invalid';
  END IF;
END $disposable_release_role$;
`;
}

// The item11 CI database is on the separate application-test cluster. Check
// the pair's effective authority there before applying its first migration.
export const disposableReleasePairPreflightSql = `DO $item11_pair$
BEGIN
  IF ${adminGuard}
     OR ${releasePairCatalogInvalid}
     OR pg_catalog.current_database() = 'postgres'
     OR pg_catalog.has_database_privilege(
          pg_catalog.to_regrole('reviewrouter_release_schema_owner'),
          pg_catalog.current_database(),'CREATE')
     OR pg_catalog.has_database_privilege(
          pg_catalog.to_regrole('reviewrouter_release_migration'),
          pg_catalog.current_database(),'CREATE')
     OR pg_catalog.has_schema_privilege(
          pg_catalog.to_regrole('reviewrouter_release_schema_owner'),'public','CREATE')
     OR pg_catalog.has_schema_privilege(
          pg_catalog.to_regrole('reviewrouter_release_migration'),'public','CREATE')
  THEN RAISE EXCEPTION 'disposable_release_pair_preflight_invalid' USING ERRCODE='42501';
  END IF;
END $item11_pair$;\n`;

// Only a role created by this run can be removed. An exact OID and the
// unchanged catalog shape are required; DROP ROLE rejects foreign dependencies.
export function disposableReleaseMigrationRoleCleanupSql(oid) {
  if (!/^[1-9][0-9]*$/u.test(String(oid)))
    throw new Error("disposable_release_role_oid_invalid");
  return `DO $item11_cleanup$
BEGIN
  IF ${adminGuard}
     OR ${releasePairCatalogInvalid}
     OR pg_catalog.current_database() <> 'postgres'
     OR (SELECT oid FROM pg_catalog.pg_roles
         WHERE rolname='reviewrouter_release_migration') <> ${oid}
  THEN RAISE EXCEPTION 'disposable_release_role_cleanup_invalid' USING ERRCODE='42501';
  END IF;
  DROP ROLE reviewrouter_release_migration;
END $item11_cleanup$;\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] === "catalog") {
    process.stdout.write(writeDisposableMigrationCatalog("before87", process.argv[3]) + "\n");
  } else if (process.argv[2] === "provision-ci") {
    const password = randomBytes(36).toString("base64url");
    const result = spawnSync("psql", ["-XqAt", "-h", "127.0.0.1", "-U", "postgres",
      "-d", "postgres", "-v", "ON_ERROR_STOP=1"], {
      input: disposableReleaseMigrationRoleSql(password), encoding: "utf8",
      env: process.env,
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.replaceAll(password, "[redacted]");
    if (output) process.stderr.write(output);
    if (result.status !== 0) throw new Error("disposable_ci_role_provision_failed");
  }
}
