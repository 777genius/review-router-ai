#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runSecretSafePostgresCommand } from "./lib/secret-safe-command-boundary.mjs";

const releaseRoleName = "reviewrouter_release_migration";
const observerRoleName = "reviewrouter_sdk_growth_schema_observer";

const logicalIdentityMigration = Object.freeze({
  predecessor: Object.freeze({
    migrationName: "000105_sdk_growth_publication_effect",
    checksum:
      "d92d4368cc20c5217cdeaf18f1abbeec7c98efd873fc91110c6178eb1739848f",
  }),
  target: Object.freeze({
    migrationName: "000106_sdk_growth_finalized_report_logical_identity",
    checksum:
      "a47efeb47fcac73f502818fdf959ff86e44c228951b2839a1b694072e98c3f6d",
  }),
});

export const sdkGrowthApplicationSchemaContract = Object.freeze({
  predecessor: Object.freeze({
    migrationName: "000104_hosted_pool_request_scoped_failover",
    checksum:
      "7e63286c8bfab3c1cf7aa559c1515fa39a47ec3f8861eefcbf569a5d462039a7",
  }),
  target: Object.freeze({
    migrationName: "000105_sdk_growth_publication_effect",
    checksum:
      "d92d4368cc20c5217cdeaf18f1abbeec7c98efd873fc91110c6178eb1739848f",
  }),
  logicalIdentity: logicalIdentityMigration,
  releaseRole: releaseRoleName,
  observerRole: observerRoleName,
});

export function sdkGrowthDatabaseIdentitySql() {
  return `SELECT json_build_object(
  'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
  'databaseOid',(SELECT oid::text FROM pg_database WHERE datname=current_database()),
  'databaseName',current_database(),
  'postgresVersion',current_setting('server_version_num')::integer,
  'sessionUser',session_user,
  'currentUser',current_user
);`;
}

function sdkGrowthDatabaseIdentityJsonSql() {
  return `json_build_object(
    'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
    'databaseOid',(SELECT oid::text FROM pg_database WHERE datname=current_database()),
    'databaseName',current_database(),
    'postgresVersion',current_setting('server_version_num')::integer,
    'sessionUser',session_user,
    'currentUser',current_user)`;
}

export function sdkGrowthDatabaseIdentityDigest(identity) {
  if (
    !identity ||
    !/^[1-9][0-9]*$/u.test(identity.systemIdentifier ?? "") ||
    !/^[1-9][0-9]*$/u.test(identity.databaseOid ?? "") ||
    !/^[A-Za-z0-9_.-]{1,63}$/u.test(identity.databaseName ?? "") ||
    identity.postgresVersion < 170000 ||
    identity.postgresVersion >= 180000
  )
    throw new Error("sdk_growth_schema_checkpoint_database_identity_rejected");
  return `sha256:${createHash("sha256")
    .update(
      `${identity.systemIdentifier}:${identity.databaseOid}:${identity.databaseName}`,
    )
    .digest("hex")}`;
}

const targetColumns = Object.freeze([
  Object.freeze({
    name: "attemptStartedAt",
    type: "timestamp(3) with time zone",
    notNull: false,
    default: null,
  }),
  Object.freeze({
    name: "completedAt",
    type: "timestamp(3) with time zone",
    notNull: false,
    default: null,
  }),
  Object.freeze({
    name: "envelopeDigest",
    type: "character varying(64)",
    notNull: true,
    default: null,
  }),
  Object.freeze({
    name: "intent",
    type: "jsonb",
    notNull: true,
    default: null,
  }),
  Object.freeze({
    name: "lastEvidence",
    type: "jsonb",
    notNull: false,
    default: null,
  }),
  Object.freeze({
    name: "outboxEventId",
    type: "text",
    notNull: false,
    default: null,
  }),
  Object.freeze({
    name: "reconciliationCount",
    type: "integer",
    notNull: true,
    default: "0",
  }),
]);
const preflightColumns = Object.freeze([
  Object.freeze({
    name: "providerCorrelation",
    type: "text",
    notNull: false,
    default: null,
  }),
]);

// pg_get_constraintdef output is part of the PG17-only checkpoint contract.
// Exact definitions reject same-name weakened expressions.
const preflightConstraints = Object.freeze([
  Object.freeze({
    name: "SdkGrowthPublicationEffect_state_check",
    type: "c",
    validated: true,
    definition:
      "CHECK ((state = ANY (ARRAY['pending'::text, 'queued'::text, 'sending'::text, 'reconcile-required'::text, 'superseded'::text, 'not-applied'::text, 'applied'::text])))",
  }),
]);
const targetConstraints = Object.freeze([
  Object.freeze({
    name: "SdkGrowthPublicationEffect_envelope_digest_check",
    type: "c",
    validated: true,
    definition: "CHECK (((\"envelopeDigest\")::text ~ '^[a-f0-9]{64}$'::text))",
  }),
  Object.freeze({
    name: "SdkGrowthPublicationEffect_intent_check",
    type: "c",
    validated: true,
    definition:
      "CHECK (((jsonb_typeof(intent) = 'object'::text) AND ((octet_length((intent)::text) >= 2) AND (octet_length((intent)::text) <= 32768))))",
  }),
  Object.freeze({
    name: "SdkGrowthPublicationEffect_reconciliation_count_check",
    type: "c",
    validated: true,
    definition:
      'CHECK ((("reconciliationCount" >= 0) AND ("reconciliationCount" <= 20)))',
  }),
  Object.freeze({
    name: "SdkGrowthPublicationEffect_shape_check",
    type: "c",
    validated: true,
    definition:
      'CHECK ((((state = \'ready\'::text) AND ("attemptId" IS NULL) AND ("attemptStartedAt" IS NULL) AND ("reconciliationCount" = 0) AND ("lastEvidence" IS NULL) AND ("completedAt" IS NULL)) OR ((state = \'sending\'::text) AND ("attemptId" IS NOT NULL) AND ("attemptStartedAt" IS NOT NULL) AND ("reconciliationCount" = 0) AND ("lastEvidence" IS NULL) AND ("completedAt" IS NULL)) OR ((state = \'reconcile-required\'::text) AND ("attemptId" IS NOT NULL) AND ("attemptStartedAt" IS NOT NULL) AND (("reconciliationCount" >= 1) AND ("reconciliationCount" <= 19)) AND ("lastEvidence" IS NOT NULL) AND ("completedAt" IS NULL)) OR ((state = \'superseded\'::text) AND ("attemptId" IS NULL) AND ("attemptStartedAt" IS NULL) AND ("reconciliationCount" = 0) AND ("lastEvidence" IS NOT NULL) AND ("completedAt" IS NOT NULL)) OR ((state = ANY (ARRAY[\'not-applied\'::text, \'applied\'::text, \'recovery-required\'::text])) AND ("attemptId" IS NOT NULL) AND ("attemptStartedAt" IS NOT NULL) AND ("lastEvidence" IS NOT NULL) AND ("completedAt" IS NOT NULL))))',
  }),
  Object.freeze({
    name: "SdkGrowthPublicationEffect_state_check",
    type: "c",
    validated: true,
    definition:
      "CHECK ((state = ANY (ARRAY['ready'::text, 'sending'::text, 'reconcile-required'::text, 'superseded'::text, 'not-applied'::text, 'applied'::text, 'recovery-required'::text])))",
  }),
]);

const targetIndex = Object.freeze({
  name: "SdkGrowthPublicationEffect_outbox_event_key",
  unique: true,
  valid: true,
  ready: true,
  live: true,
  keyColumns: Object.freeze(["outboxEventId"]),
  predicate: null,
  expressions: null,
});
const targetTriggers = Object.freeze([
  Object.freeze({
    name: "sdk_growth_publication_immutable",
    enabled: "O",
    type: 27,
    functionSchema: "public",
    functionName: "sdk_growth_publication_preserve",
    constraint: false,
    when: null,
    updateColumns: "",
  }),
  Object.freeze({
    name: "sdk_growth_publication_no_truncate",
    enabled: "O",
    type: 34,
    functionSchema: "public",
    functionName: "sdk_growth_publication_preserve",
    constraint: false,
    when: null,
    updateColumns: "",
  }),
]);

export const sdkGrowthApplicationSchemaShape = Object.freeze({
  preflightColumns,
  preflightConstraints,
  columns: targetColumns,
  constraints: targetConstraints,
  index: targetIndex,
  triggers: targetTriggers,
});

const finalizedReportConstraints = Object.freeze([
  "SdkGrowthFinalizedReportEvidence_candidateWritable_check",
  "SdkGrowthFinalizedReportEvidence_coverage_check",
  "SdkGrowthFinalizedReportEvidence_coveredScopes_check",
  "SdkGrowthFinalizedReportEvidence_evidenceId_fkey",
  "SdkGrowthFinalizedReportEvidence_finalizedReport_check",
  "SdkGrowthFinalizedReportEvidence_outcome_check",
  "SdkGrowthFinalizedReportEvidence_phases_check",
  "SdkGrowthFinalizedReportEvidence_pkey",
  "SdkGrowthFinalizedReportEvidence_producer_check",
  "SdkGrowthFinalizedReportEvidence_reportDigest_check",
  "SdkGrowthFinalizedReportEvidence_verifierRevision_check",
]);

const finalizedReportColumns = Object.freeze([
  Object.freeze({
    name: "candidateWritable",
    type: "boolean",
    notNull: true,
    default: "false",
  }),
  Object.freeze({
    name: "coverage",
    type: "text",
    notNull: true,
    default: null,
  }),
  Object.freeze({
    name: "coveredScopes",
    type: "jsonb",
    notNull: true,
    default: null,
  }),
  Object.freeze({
    name: "createdAt",
    type: "timestamp(3) with time zone",
    notNull: true,
    default: "CURRENT_TIMESTAMP",
  }),
  Object.freeze({
    name: "evidenceId",
    type: "text",
    notNull: true,
    default: null,
  }),
  Object.freeze({
    name: "finalizedReport",
    type: "bytea",
    notNull: true,
    default: null,
  }),
  Object.freeze({
    name: "grantId",
    type: "character varying(2048)",
    notNull: true,
    default: null,
  }),
  Object.freeze({
    name: "outcome",
    type: "text",
    notNull: true,
    default: null,
  }),
  Object.freeze({
    name: "phases",
    type: "jsonb",
    notNull: true,
    default: null,
  }),
  Object.freeze({
    name: "producer",
    type: "text",
    notNull: true,
    default: null,
  }),
  Object.freeze({
    name: "reportDigest",
    type: "character varying(71)",
    notNull: true,
    default: null,
  }),
  Object.freeze({
    name: "reportEvidenceId",
    type: "text",
    notNull: true,
    default: null,
  }),
  Object.freeze({
    name: "repositoryId",
    type: "character varying(256)",
    notNull: true,
    default: null,
  }),
  Object.freeze({
    name: "runAttempt",
    type: "character varying(256)",
    notNull: true,
    default: null,
  }),
  Object.freeze({
    name: "runId",
    type: "character varying(256)",
    notNull: true,
    default: null,
  }),
  Object.freeze({
    name: "verifierRevision",
    type: "character varying(40)",
    notNull: true,
    default: null,
  }),
]);

export const sdkGrowthFinalizedReportShape = Object.freeze({
  columns: finalizedReportColumns,
  constraints: finalizedReportConstraints,
  digestConstraint: "SdkGrowthFinalizedReportEvidence_digest_key",
  preflightConstraintDigest:
    "c8def03f86f42efc877f3f01af9cd55fcb9f253345ff0878ad8a4321900f8b83",
  postflightConstraintDigest:
    "3546009d14d16a6a0fa67e0911028c335a35accf948bbe10f460b203490ba24b",
  immutableTrigger: "sdk_growth_finalized_report_immutable",
});

function checkpointContract(phase) {
  if (phase === "preflight" || phase === "postflight")
    return {
      contract: sdkGrowthApplicationSchemaContract,
      applied: phase === "postflight",
      logicalIdentity: false,
    };
  if (phase === "preflight-000106" || phase === "postflight-000106")
    return {
      contract: logicalIdentityMigration,
      applied: phase === "postflight-000106",
      logicalIdentity: true,
    };
  throw new Error("sdk_growth_schema_checkpoint_phase_rejected");
}

const sqlLiteral = (value) => `'${String(value).replaceAll("'", "''")}'`;

function migrationPath(name) {
  return resolve(
    import.meta.dirname,
    `../packages/platform/db/prisma/migrations/${name}/migration.sql`,
  );
}

function publicationPreserveSource(migrationName) {
  const source = readFileSync(migrationPath(migrationName), "utf8");
  const match =
    /CREATE FUNCTION sdk_growth_publication_preserve\(\) RETURNS trigger[\s\S]+?AS \$\$([\s\S]+?)\$\$;/u.exec(
      source,
    );
  if (!match?.[1])
    throw new Error("sdk_growth_schema_checkpoint_source_function_rejected");
  return match[1];
}

function expectedFunctionSourceHash(phase) {
  const migration =
    phase === "preflight"
      ? "000103_sdk_growth_authority_custody"
      : sdkGrowthApplicationSchemaContract.target.migrationName;
  return createHash("sha256")
    .update(publicationPreserveSource(migration))
    .digest("hex");
}

function verifierFunctionSourceHash() {
  const source = readFileSync(
    migrationPath("000103_sdk_growth_authority_custody"),
    "utf8",
  );
  const match =
    /CREATE FUNCTION sdk_growth_verifier_evidence_preserve\(\) RETURNS trigger[\s\S]+?AS \$\$([\s\S]+?)\$\$;/u.exec(
      source,
    );
  if (!match?.[1])
    throw new Error("sdk_growth_schema_checkpoint_source_function_rejected");
  return createHash("sha256").update(match[1]).digest("hex");
}

export function sdkGrowthApplicationSchemaObserverGrantSql() {
  return `DO $observer_role$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname=${sqlLiteral(observerRoleName)}
      AND rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
      AND NOT rolreplication AND NOT rolbypassrls AND NOT rolinherit
      AND NOT EXISTS (
        SELECT 1 FROM pg_auth_members membership
        WHERE membership.member=pg_roles.oid
      )
  ) THEN
    RAISE EXCEPTION 'sdk growth schema observer role is not exact';
  END IF;
END
$observer_role$;
GRANT USAGE ON SCHEMA public TO ${observerRoleName};
REVOKE ALL ON TABLE public._prisma_migrations FROM ${observerRoleName};
REVOKE ALL ON TABLE public."SdkGrowthPublicationEffect" FROM ${observerRoleName};
REVOKE ALL ON TABLE public."SdkGrowthFinalizedReportEvidence" FROM ${observerRoleName};
DO $observer_columns$
DECLARE
  observed_column record;
BEGIN
  FOR observed_column IN
    SELECT namespace.nspname AS schema_name, relation.relname AS table_name,
      attribute.attname AS column_name
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
    JOIN pg_attribute attribute ON attribute.attrelid=relation.oid
    WHERE namespace.nspname='public'
      AND relation.relname IN ('_prisma_migrations','SdkGrowthPublicationEffect','SdkGrowthFinalizedReportEvidence')
      AND attribute.attnum>0 AND NOT attribute.attisdropped
  LOOP
    EXECUTE format(
      'REVOKE ALL PRIVILEGES (%I) ON TABLE %I.%I FROM %I',
      observed_column.column_name,
      observed_column.schema_name,
      observed_column.table_name,
      ${sqlLiteral(observerRoleName)}
    );
  END LOOP;
END
$observer_columns$;
GRANT SELECT ON TABLE public._prisma_migrations TO ${observerRoleName};
GRANT SELECT ON TABLE public."SdkGrowthPublicationEffect" TO ${observerRoleName};
GRANT SELECT ON TABLE public."SdkGrowthFinalizedReportEvidence" TO ${observerRoleName};`;
}

export function sdkGrowthReleaseLoginProbeSql() {
  return `SELECT json_build_object(
  'databaseIdentity', ${sdkGrowthDatabaseIdentityJsonSql()},
  'sessionUser', session_user,
  'currentUser', current_user,
  'releaseRole', (SELECT json_build_object(
    'exists', true, 'login', rolcanlogin, 'inherit', rolinherit,
    'superuser', rolsuper, 'createDatabase', rolcreatedb,
    'createRole', rolcreaterole, 'replication', rolreplication,
    'bypassRls', rolbypassrls)
    FROM pg_roles WHERE rolname=${sqlLiteral(releaseRoleName)}),
  'ledgerSelect', has_table_privilege(${sqlLiteral(releaseRoleName)},'public._prisma_migrations','SELECT'),
  'publicationPrivileges', json_build_object(
    'select',has_table_privilege(${sqlLiteral(releaseRoleName)},'public."SdkGrowthPublicationEffect"','SELECT'),
    'insert',has_table_privilege(${sqlLiteral(releaseRoleName)},'public."SdkGrowthPublicationEffect"','INSERT'),
    'update',has_table_privilege(${sqlLiteral(releaseRoleName)},'public."SdkGrowthPublicationEffect"','UPDATE'),
    'delete',has_table_privilege(${sqlLiteral(releaseRoleName)},'public."SdkGrowthPublicationEffect"','DELETE'),
    'truncate',has_table_privilege(${sqlLiteral(releaseRoleName)},'public."SdkGrowthPublicationEffect"','TRUNCATE'),
    'references',has_table_privilege(${sqlLiteral(releaseRoleName)},'public."SdkGrowthPublicationEffect"','REFERENCES'),
    'trigger',has_table_privilege(${sqlLiteral(releaseRoleName)},'public."SdkGrowthPublicationEffect"','TRIGGER'))
);`;
}

export function sdkGrowthApplicationSchemaObservationSql({
  phase = "postflight",
} = {}) {
  const { contract } = checkpointContract(phase);
  const observedColumnNames = [
    ...targetColumns.map(({ name }) => name),
    "providerCorrelation",
  ];
  return `SELECT json_build_object(
  'databaseIdentity', ${sdkGrowthDatabaseIdentityJsonSql()},
  'postgresVersion', current_setting('server_version_num')::integer,
  'sessionUser', session_user,
  'currentUser', current_user,
  'observerRole', (SELECT json_build_object(
    'exists', true, 'login', rolcanlogin, 'inherit', rolinherit,
    'superuser', rolsuper, 'createDatabase', rolcreatedb,
    'createRole', rolcreaterole, 'replication', rolreplication,
    'bypassRls', rolbypassrls)
    FROM pg_roles WHERE rolname=${sqlLiteral(observerRoleName)}),
  'observerSchemaPrivileges', json_build_object(
    'usage',has_schema_privilege(${sqlLiteral(observerRoleName)},'public','USAGE'),
    'create',has_schema_privilege(${sqlLiteral(observerRoleName)},'public','CREATE')),
  'predecessor', coalesce((SELECT json_agg(json_build_object(
    'checksum',checksum, 'finished',finished_at IS NOT NULL,
    'rolledBack',rolled_back_at IS NOT NULL,
    'appliedStepsCount',applied_steps_count) ORDER BY started_at)
    FROM public._prisma_migrations
    WHERE migration_name=${sqlLiteral(contract.predecessor.migrationName)}),'[]'::json),
  'target', coalesce((SELECT json_agg(json_build_object(
    'checksum',checksum, 'finished',finished_at IS NOT NULL,
    'rolledBack',rolled_back_at IS NOT NULL,
    'appliedStepsCount',applied_steps_count) ORDER BY started_at)
    FROM public._prisma_migrations
    WHERE migration_name=${sqlLiteral(contract.target.migrationName)}),'[]'::json),
  'laterMigrationCount', (SELECT count(*)::integer
    FROM public._prisma_migrations
    WHERE migration_name>${sqlLiteral(contract.target.migrationName)}
      AND rolled_back_at IS NULL),
  'legacyRowCount', (SELECT count(*)::integer
    FROM public."SdkGrowthPublicationEffect"),
  'finalizedReportRowCount', (SELECT count(*)::integer
    FROM public."SdkGrowthFinalizedReportEvidence"),
  'finalizedReportColumns', coalesce((SELECT json_agg(json_build_object(
      'name',attribute.attname,
      'type',format_type(attribute.atttypid,attribute.atttypmod),
      'notNull',attribute.attnotnull,
      'default',pg_get_expr(default_row.adbin,default_row.adrelid))
    ORDER BY attribute.attname)
    FROM pg_attribute attribute
    LEFT JOIN pg_attrdef default_row ON default_row.adrelid=attribute.attrelid
      AND default_row.adnum=attribute.attnum
    WHERE attribute.attrelid='public."SdkGrowthFinalizedReportEvidence"'::regclass
      AND attribute.attnum>0 AND NOT attribute.attisdropped), '[]'::json),
  'finalizedReportConstraints', coalesce((SELECT json_agg(constraint_row.conname
      ORDER BY constraint_row.conname)
    FROM pg_constraint constraint_row
    WHERE constraint_row.conrelid='public."SdkGrowthFinalizedReportEvidence"'::regclass
      AND constraint_row.convalidated),'[]'::json),
  'finalizedReportConstraintDigest', (SELECT encode(pg_catalog.sha256(convert_to(
      string_agg(constraint_row.conname||'='||pg_get_constraintdef(constraint_row.oid,false),E'\\n'
        ORDER BY constraint_row.conname),'UTF8')),'hex')
    FROM pg_constraint constraint_row
    WHERE constraint_row.conrelid='public."SdkGrowthFinalizedReportEvidence"'::regclass
      AND constraint_row.convalidated),
  'finalizedReportDigestIndexes', (SELECT count(*)::integer
    FROM pg_index index_row
    JOIN pg_class index_relation ON index_relation.oid=index_row.indexrelid
    WHERE index_row.indrelid='public."SdkGrowthFinalizedReportEvidence"'::regclass
      AND index_row.indisunique
      AND (index_relation.relname=${sqlLiteral(sdkGrowthFinalizedReportShape.digestConstraint)}
        OR (SELECT array_agg(attribute.attname ORDER BY key_row.ordinality)
          FROM unnest(index_row.indkey::smallint[]) WITH ORDINALITY key_row(attnum,ordinality)
          JOIN pg_attribute attribute ON attribute.attrelid=index_row.indrelid
            AND attribute.attnum=key_row.attnum
          WHERE key_row.ordinality<=index_row.indnkeyatts)
          = ARRAY['evidenceId','reportDigest']::name[])),
  'finalizedReportTrigger', (SELECT json_build_object(
      'name',trigger_row.tgname,'enabled',trigger_row.tgenabled,
      'type',trigger_row.tgtype::integer,'functionSchema',routine_namespace.nspname,
      'functionName',routine.proname,'functionOid',routine.oid::text,
      'constraint',trigger_row.tgconstraint<>0,
      'when',pg_get_expr(trigger_row.tgqual,trigger_row.tgrelid),
      'updateColumns',trigger_row.tgattr::text)
    FROM pg_trigger trigger_row
    JOIN pg_proc routine ON routine.oid=trigger_row.tgfoid
    JOIN pg_namespace routine_namespace ON routine_namespace.oid=routine.pronamespace
    WHERE trigger_row.tgrelid='public."SdkGrowthFinalizedReportEvidence"'::regclass
      AND NOT trigger_row.tgisinternal
      AND trigger_row.tgname=${sqlLiteral(sdkGrowthFinalizedReportShape.immutableTrigger)}),
  'finalizedReportOwnership', (SELECT json_build_object(
    'tableOwner',table_owner.rolname,'functionOwner',function_owner.rolname,
    'functionOid',routine.oid::text,
    'functionConfig',coalesce(routine.proconfig,'{}'::text[]),
    'functionSecurityDefiner',routine.prosecdef,'functionVolatility',routine.provolatile,
    'functionSource',routine.prosrc,
    'publicCanExecute',has_function_privilege('public',routine.oid,'EXECUTE'))
    FROM pg_class relation JOIN pg_roles table_owner ON table_owner.oid=relation.relowner
    JOIN pg_proc routine ON routine.proname='sdk_growth_verifier_evidence_preserve'
      AND routine.pronargs=0 AND routine.prorettype='trigger'::regtype
    JOIN pg_namespace routine_namespace ON routine_namespace.oid=routine.pronamespace AND routine_namespace.nspname='public'
    JOIN pg_roles function_owner ON function_owner.oid=routine.proowner
    WHERE relation.oid='public."SdkGrowthFinalizedReportEvidence"'::regclass),
  'columns', coalesce((SELECT json_agg(json_build_object(
      'name',attribute.attname,
      'type',format_type(attribute.atttypid,attribute.atttypmod),
      'notNull',attribute.attnotnull,
      'default',pg_get_expr(default_row.adbin,default_row.adrelid))
    ORDER BY attribute.attname)
    FROM pg_attribute attribute
    LEFT JOIN pg_attrdef default_row ON default_row.adrelid=attribute.attrelid
      AND default_row.adnum=attribute.attnum
    WHERE attribute.attrelid='public."SdkGrowthPublicationEffect"'::regclass
      AND attribute.attnum>0 AND NOT attribute.attisdropped
      AND attribute.attname = ANY(ARRAY[${observedColumnNames.map(sqlLiteral).join(",")}])), '[]'::json),
  'constraints', coalesce((SELECT json_agg(json_build_object(
      'name',constraint_row.conname, 'type',constraint_row.contype,
      'validated',constraint_row.convalidated,
      'definition',pg_get_constraintdef(constraint_row.oid,false))
    ORDER BY constraint_row.conname)
    FROM pg_constraint constraint_row
    WHERE constraint_row.conrelid='public."SdkGrowthPublicationEffect"'::regclass
      AND constraint_row.conname = ANY(ARRAY[${targetConstraints.map(({ name }) => sqlLiteral(name)).join(",")}])),'[]'::json),
  'indexes', coalesce((SELECT json_agg(json_build_object(
      'name',index_relation.relname, 'unique',index_row.indisunique,
      'valid',index_row.indisvalid, 'ready',index_row.indisready,
      'live',index_row.indislive,
      'keyColumns',(SELECT json_agg(attribute.attname ORDER BY key_row.ordinality)
        FROM unnest(index_row.indkey::smallint[]) WITH ORDINALITY key_row(attnum, ordinality)
        JOIN pg_attribute attribute ON attribute.attrelid=index_row.indrelid
          AND attribute.attnum=key_row.attnum
        WHERE key_row.ordinality<=index_row.indnkeyatts),
      'predicate',pg_get_expr(index_row.indpred,index_row.indrelid),
      'expressions',pg_get_expr(index_row.indexprs,index_row.indrelid))
    ORDER BY index_relation.relname)
    FROM pg_index index_row
    JOIN pg_class index_relation ON index_relation.oid=index_row.indexrelid
    WHERE index_row.indrelid='public."SdkGrowthPublicationEffect"'::regclass
      AND index_relation.relname='SdkGrowthPublicationEffect_outbox_event_key'),'[]'::json),
  'triggers', coalesce((SELECT json_agg(json_build_object(
      'name',trigger_row.tgname, 'enabled',trigger_row.tgenabled,
      'type',trigger_row.tgtype::integer,
      'functionSchema',routine_namespace.nspname,
      'functionName',routine.proname,
      'constraint',trigger_row.tgconstraint<>0,
      'when',pg_get_expr(trigger_row.tgqual,trigger_row.tgrelid),
      'updateColumns',trigger_row.tgattr::text)
    ORDER BY trigger_row.tgname)
    FROM pg_trigger trigger_row
    JOIN pg_proc routine ON routine.oid=trigger_row.tgfoid
    JOIN pg_namespace routine_namespace ON routine_namespace.oid=routine.pronamespace
    WHERE trigger_row.tgrelid='public."SdkGrowthPublicationEffect"'::regclass
      AND NOT trigger_row.tgisinternal
      AND trigger_row.tgname = ANY(ARRAY[${targetTriggers.map(({ name }) => sqlLiteral(name)).join(",")}])),'[]'::json),
  'ownership', (SELECT json_build_object(
    'tableOwner',table_owner.rolname,
    'functionOwner',function_owner.rolname,
    'functionConfig',coalesce(routine.proconfig,'{}'::text[]),
    'functionSecurityDefiner',routine.prosecdef,
    'functionVolatility',routine.provolatile,
    'functionSource',routine.prosrc,
    'publicCanExecute',has_function_privilege('public',routine.oid,'EXECUTE'))
    FROM pg_class relation
    JOIN pg_roles table_owner ON table_owner.oid=relation.relowner
    JOIN pg_proc routine ON routine.proname='sdk_growth_publication_preserve'
      AND routine.pronargs=0 AND routine.prorettype='trigger'::regtype
    JOIN pg_namespace routine_namespace ON routine_namespace.oid=routine.pronamespace
      AND routine_namespace.nspname='public'
    JOIN pg_roles function_owner ON function_owner.oid=routine.proowner
    WHERE relation.oid='public."SdkGrowthPublicationEffect"'::regclass),
  'observerGrants', coalesce((SELECT json_agg(json_build_object(
      'schema',namespace.nspname,'table',relation.relname,'privilege',acl.privilege_type)
      ORDER BY namespace.nspname,relation.relname,acl.privilege_type)
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
    CROSS JOIN LATERAL aclexplode(coalesce(relation.relacl,acldefault('r',relation.relowner))) acl
    WHERE acl.grantee=${sqlLiteral(observerRoleName)}::regrole),'[]'::json),
  'observerTablePrivileges', (SELECT json_agg(json_build_object(
      'schema',namespace.nspname,'table',relation.relname,
      'select',has_table_privilege(${sqlLiteral(observerRoleName)},relation.oid,'SELECT'),
      'insert',has_table_privilege(${sqlLiteral(observerRoleName)},relation.oid,'INSERT'),
      'update',has_table_privilege(${sqlLiteral(observerRoleName)},relation.oid,'UPDATE'),
      'delete',has_table_privilege(${sqlLiteral(observerRoleName)},relation.oid,'DELETE'),
      'truncate',has_table_privilege(${sqlLiteral(observerRoleName)},relation.oid,'TRUNCATE'),
      'references',has_table_privilege(${sqlLiteral(observerRoleName)},relation.oid,'REFERENCES'),
      'trigger',has_table_privilege(${sqlLiteral(observerRoleName)},relation.oid,'TRIGGER'))
      ORDER BY namespace.nspname,relation.relname)
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
    WHERE namespace.nspname='public'
      AND relation.relname IN ('_prisma_migrations','SdkGrowthFinalizedReportEvidence','SdkGrowthPublicationEffect')),
  'observerColumnWrites', coalesce((SELECT json_agg(json_build_object(
      'schema',namespace.nspname,'table',relation.relname,'column',attribute.attname,
      'insert',has_column_privilege(${sqlLiteral(observerRoleName)},relation.oid,attribute.attnum,'INSERT'),
      'update',has_column_privilege(${sqlLiteral(observerRoleName)},relation.oid,attribute.attnum,'UPDATE'),
      'references',has_column_privilege(${sqlLiteral(observerRoleName)},relation.oid,attribute.attnum,'REFERENCES'))
      ORDER BY namespace.nspname,relation.relname,attribute.attnum)
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
    JOIN pg_attribute attribute ON attribute.attrelid=relation.oid
      AND attribute.attnum>0 AND NOT attribute.attisdropped
    WHERE namespace.nspname='public'
      AND relation.relname IN ('_prisma_migrations','SdkGrowthFinalizedReportEvidence','SdkGrowthPublicationEffect')
      AND (has_column_privilege(${sqlLiteral(observerRoleName)},relation.oid,attribute.attnum,'INSERT')
        OR has_column_privilege(${sqlLiteral(observerRoleName)},relation.oid,attribute.attnum,'UPDATE')
        OR has_column_privilege(${sqlLiteral(observerRoleName)},relation.oid,attribute.attnum,'REFERENCES'))),'[]'::json),
  'observerMemberships', coalesce((SELECT json_agg(json_build_object(
      'role',granted_role.rolname,'admin',membership.admin_option,
      'inherit',membership.inherit_option,'set',membership.set_option)
      ORDER BY granted_role.rolname)
    FROM pg_auth_members membership
    JOIN pg_roles granted_role ON granted_role.oid=membership.roleid
    WHERE membership.member=${sqlLiteral(observerRoleName)}::regrole),'[]'::json),
  'runtimeRoles', (SELECT json_agg(json_build_object(
    'role',role_name,
    'select',has_table_privilege(role_name,'public."SdkGrowthPublicationEffect"','SELECT'),
    'insert',has_table_privilege(role_name,'public."SdkGrowthPublicationEffect"','INSERT'),
    'update',has_table_privilege(role_name,'public."SdkGrowthPublicationEffect"','UPDATE'),
    'delete',has_table_privilege(role_name,'public."SdkGrowthPublicationEffect"','DELETE'),
    'truncate',has_table_privilege(role_name,'public."SdkGrowthPublicationEffect"','TRUNCATE'),
    'references',has_table_privilege(role_name,'public."SdkGrowthPublicationEffect"','REFERENCES'),
    'trigger',has_table_privilege(role_name,'public."SdkGrowthPublicationEffect"','TRIGGER')) ORDER BY role_name)
    FROM unnest(ARRAY['reviewrouter_api','reviewrouter_worker']) role_name)
);`;
}

function exact(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function assertRestrictedLogin(role, label, expectedInherit) {
  if (
    !role ||
    role.exists !== true ||
    role.login !== true ||
    role.inherit !== expectedInherit ||
    role.superuser !== false ||
    role.createDatabase !== false ||
    role.createRole !== false ||
    role.replication !== false ||
    role.bypassRls !== false
  )
    throw new Error(`sdk_growth_schema_checkpoint_${label}_role_rejected`);
}

function assertMigrationRow(rows, expected, label) {
  if (
    !Array.isArray(rows) ||
    rows.length !== 1 ||
    rows[0]?.checksum !== expected.checksum ||
    rows[0]?.finished !== true ||
    rows[0]?.rolledBack !== false ||
    rows[0]?.appliedStepsCount !== 1
  )
    throw new Error(`sdk_growth_schema_checkpoint_${label}_rejected`);
}

export function assertSdkGrowthApplicationSchemaCheckpoint(
  observation,
  { phase } = {},
) {
  const checkpoint = checkpointContract(phase);
  if (
    !observation ||
    observation.postgresVersion < 170000 ||
    observation.postgresVersion >= 180000
  )
    throw new Error("sdk_growth_schema_checkpoint_postgres_rejected");
  if (
    observation.sessionUser !== observerRoleName ||
    observation.currentUser !== observerRoleName
  )
    throw new Error("sdk_growth_schema_checkpoint_observer_caller_rejected");
  assertRestrictedLogin(observation.observerRole, "observer", false);
  if (
    !exact(observation.observerSchemaPrivileges, {
      usage: true,
      create: false,
    })
  )
    throw new Error(
      "sdk_growth_schema_checkpoint_observer_permissions_rejected",
    );
  if (
    observation.releaseProbe?.sessionUser !== releaseRoleName ||
    observation.releaseProbe?.currentUser !== releaseRoleName
  )
    throw new Error("sdk_growth_schema_checkpoint_release_caller_rejected");
  assertRestrictedLogin(observation.releaseProbe?.releaseRole, "release", true);
  const noPrivileges = {
    select: false,
    insert: false,
    update: false,
    delete: false,
    truncate: false,
    references: false,
    trigger: false,
  };
  if (
    observation.releaseProbe?.ledgerSelect !== true ||
    !exact(observation.releaseProbe?.publicationPrivileges, noPrivileges)
  )
    throw new Error(
      "sdk_growth_schema_checkpoint_release_permissions_rejected",
    );
  if (
    !exact(observation.observerGrants, [
      {
        schema: "public",
        table: "SdkGrowthFinalizedReportEvidence",
        privilege: "SELECT",
      },
      {
        schema: "public",
        table: "SdkGrowthPublicationEffect",
        privilege: "SELECT",
      },
      { schema: "public", table: "_prisma_migrations", privilege: "SELECT" },
    ]) ||
    !exact(observation.observerTablePrivileges, [
      {
        schema: "public",
        table: "SdkGrowthFinalizedReportEvidence",
        ...noPrivileges,
        select: true,
      },
      {
        schema: "public",
        table: "SdkGrowthPublicationEffect",
        ...noPrivileges,
        select: true,
      },
      {
        schema: "public",
        table: "_prisma_migrations",
        ...noPrivileges,
        select: true,
      },
    ]) ||
    !exact(observation.observerColumnWrites, []) ||
    !exact(observation.observerMemberships, [])
  )
    throw new Error(
      "sdk_growth_schema_checkpoint_observer_permissions_rejected",
    );
  assertMigrationRow(
    observation.predecessor,
    checkpoint.contract.predecessor,
    "predecessor",
  );
  if (observation.laterMigrationCount !== 0)
    throw new Error("sdk_growth_schema_checkpoint_later_migration_rejected");
  if (observation.legacyRowCount !== 0)
    throw new Error("sdk_growth_schema_checkpoint_legacy_rows_rejected");
  if (checkpoint.logicalIdentity && observation.finalizedReportRowCount !== 0)
    throw new Error("sdk_growth_schema_checkpoint_legacy_rows_rejected");
  const expectedConstraints =
    phase === "preflight" ? preflightConstraints : targetConstraints;
  const constraintsMatch =
    observation.constraints?.length === expectedConstraints.length &&
    observation.constraints.every((actual, index) => {
      const expected = expectedConstraints[index];
      return (
        actual.name === expected.name &&
        actual.type === expected.type &&
        actual.validated === expected.validated &&
        actual.definition === expected.definition
      );
    });
  if (
    !exact(
      observation.columns,
      phase === "preflight" ? preflightColumns : targetColumns,
    ) ||
    !constraintsMatch ||
    !exact(observation.indexes, phase === "preflight" ? [] : [targetIndex]) ||
    !exact(observation.triggers, targetTriggers)
  )
    throw new Error("sdk_growth_schema_checkpoint_semantics_rejected");
  if (
    createHash("sha256")
      .update(observation.ownership?.functionSource ?? "")
      .digest("hex") !== expectedFunctionSourceHash(phase) ||
    observation.ownership?.functionSecurityDefiner !== false ||
    observation.ownership?.functionVolatility !== "v" ||
    !exact(observation.ownership?.functionConfig, [
      "search_path=pg_catalog, pg_temp",
    ]) ||
    observation.ownership?.publicCanExecute !== false
  )
    throw new Error("sdk_growth_schema_checkpoint_function_semantics_rejected");
  if (!checkpoint.applied) {
    if (!exact(observation.target, []))
      throw new Error("sdk_growth_schema_checkpoint_partial_upgrade_rejected");
  } else {
    assertMigrationRow(
      observation.target,
      checkpoint.contract.target,
      "target",
    );
    if (
      observation.ownership?.tableOwner !==
        "reviewrouter_release_schema_owner" ||
      observation.ownership?.functionOwner !==
        "reviewrouter_release_schema_owner"
    )
      throw new Error("sdk_growth_schema_checkpoint_ownership_rejected");
    const expectedPrivileges = {
      select: true,
      insert: true,
      update: true,
      delete: true,
      truncate: false,
      references: false,
      trigger: false,
    };
    if (
      !exact(
        observation.runtimeRoles?.map((entry) => entry.role),
        ["reviewrouter_api", "reviewrouter_worker"],
      ) ||
      observation.runtimeRoles.some((entry) =>
        Object.entries(expectedPrivileges).some(
          ([key, value]) => entry[key] !== value,
        ),
      )
    )
      throw new Error("sdk_growth_schema_checkpoint_permissions_rejected");
  }
  if (checkpoint.logicalIdentity) {
    const expectedConstraints = checkpoint.applied
      ? finalizedReportConstraints
      : [
          ...finalizedReportConstraints,
          sdkGrowthFinalizedReportShape.digestConstraint,
        ].sort();
    if (
      !exact(
        observation.finalizedReportColumns,
        sdkGrowthFinalizedReportShape.columns,
      ) ||
      !exact(observation.finalizedReportConstraints, expectedConstraints) ||
      observation.finalizedReportConstraintDigest !==
        (checkpoint.applied
          ? sdkGrowthFinalizedReportShape.postflightConstraintDigest
          : sdkGrowthFinalizedReportShape.preflightConstraintDigest) ||
      observation.finalizedReportDigestIndexes !==
        (checkpoint.applied ? 0 : 1) ||
      !exact(observation.finalizedReportTrigger, {
        name: sdkGrowthFinalizedReportShape.immutableTrigger,
        enabled: "O",
        type: 58,
        functionSchema: "public",
        functionName: "sdk_growth_verifier_evidence_preserve",
        functionOid: observation.finalizedReportOwnership?.functionOid,
        constraint: false,
        when: null,
        updateColumns: "",
      }) ||
      observation.finalizedReportOwnership?.tableOwner !==
        "reviewrouter_release_schema_owner" ||
      observation.finalizedReportOwnership?.functionOwner !==
        "reviewrouter_release_schema_owner" ||
      !/^[1-9][0-9]*$/u.test(
        observation.finalizedReportOwnership?.functionOid ?? "",
      ) ||
      !exact(observation.finalizedReportOwnership?.functionConfig, [
        "search_path=pg_catalog, pg_temp",
      ]) ||
      observation.finalizedReportOwnership?.functionSecurityDefiner !== false ||
      observation.finalizedReportOwnership?.functionVolatility !== "v" ||
      observation.finalizedReportOwnership?.publicCanExecute !== false ||
      createHash("sha256")
        .update(observation.finalizedReportOwnership?.functionSource ?? "")
        .digest("hex") !== verifierFunctionSourceHash()
    )
      throw new Error("sdk_growth_schema_checkpoint_logical_identity_rejected");
  }
  return observation;
}

function parseRestrictedDatabaseUrl(value, expectedUsername) {
  let url;
  try {
    url = new URL(value ?? "");
  } catch {
    throw new Error("sdk_growth_schema_checkpoint_database_role_rejected");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    decodeURIComponent(url.username) !== expectedUsername ||
    !url.password
  )
    throw new Error("sdk_growth_schema_checkpoint_database_role_rejected");
  return url;
}

export function validateSdkGrowthCheckpointEnvironment(env, headSha) {
  const phase = env.REVIEW_ROUTER_SDK_GROWTH_SCHEMA_CHECKPOINT_PHASE;
  const releaseCommit = env.REVIEW_ROUTER_RELEASE_COMMIT_SHA;
  if (
    ![
      "preflight",
      "postflight",
      "preflight-000106",
      "postflight-000106",
    ].includes(phase) ||
    !/^[a-f0-9]{40}$/u.test(releaseCommit ?? "") ||
    releaseCommit !== headSha
  )
    throw new Error("sdk_growth_schema_checkpoint_release_identity_rejected");
  if (env.REVIEW_ROUTER_SDK_GROWTH_AUTHORITY_ENABLED !== "0")
    throw new Error("sdk_growth_schema_checkpoint_flag_rejected");
  if (env.REVIEW_ROUTER_OUTBOX_FENCED_TAKEOVER_ENABLED !== "1")
    throw new Error("sdk_growth_schema_checkpoint_fencing_rejected");
  const releaseDatabaseUrl = parseRestrictedDatabaseUrl(
    env.REVIEW_ROUTER_RELEASE_MIGRATION_DATABASE_URL,
    releaseRoleName,
  );
  const observerDatabaseUrl = parseRestrictedDatabaseUrl(
    env.REVIEW_ROUTER_SDK_GROWTH_SCHEMA_OBSERVER_DATABASE_URL,
    observerRoleName,
  );
  const migrationChecksum = createHash("sha256")
    .update(
      readFileSync(
        migrationPath(sdkGrowthApplicationSchemaContract.target.migrationName),
      ),
    )
    .digest("hex");
  if (migrationChecksum !== sdkGrowthApplicationSchemaContract.target.checksum)
    throw new Error("sdk_growth_schema_checkpoint_source_checksum_rejected");
  const expectedDatabaseIdentity =
    env.REVIEW_ROUTER_SDK_GROWTH_DATABASE_IDENTITY || undefined;
  if (
    (phase.startsWith("postflight") &&
      expectedDatabaseIdentity === undefined) ||
    (expectedDatabaseIdentity !== undefined &&
      !/^sha256:[a-f0-9]{64}$/u.test(expectedDatabaseIdentity))
  )
    throw new Error("sdk_growth_schema_checkpoint_database_identity_rejected");
  return {
    phase,
    releaseCommit,
    releaseDatabaseUrl,
    observerDatabaseUrl,
    expectedDatabaseIdentity,
  };
}

function checked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    ...options,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    timeout: 30_000,
  });
  if (result.status !== 0 || result.error)
    throw new Error("sdk_growth_schema_checkpoint_command_failed");
  return result.stdout.trim();
}

function observe(databaseUrl, sql) {
  const { stdout } = runSecretSafePostgresCommand({
    databaseUrl,
    args: [
      "--no-psqlrc",
      "--tuples-only",
      "--no-align",
      "--set",
      "ON_ERROR_STOP=1",
    ],
    input: sql,
    timeoutMs: 30_000,
    maxBuffer: 1024 * 1024,
  });
  try {
    return JSON.parse(stdout.trim());
  } catch {
    throw new Error("sdk_growth_schema_checkpoint_observation_rejected");
  }
}

export function observeSdkGrowthDatabaseIdentity(databaseUrl) {
  const identity = observe(databaseUrl, sdkGrowthDatabaseIdentitySql());
  return Object.freeze({
    ...identity,
    digest: sdkGrowthDatabaseIdentityDigest(identity),
  });
}

export function observeSdkGrowthApplicationSchemaCheckpoint(
  configuration,
  observeQuery = observe,
) {
  const releaseProbe = observeQuery(
    configuration.releaseDatabaseUrl,
    sdkGrowthReleaseLoginProbeSql(),
  );
  const observation = {
    ...observeQuery(
      configuration.observerDatabaseUrl,
      sdkGrowthApplicationSchemaObservationSql({ phase: configuration.phase }),
    ),
    releaseProbe,
  };
  const releaseDatabaseIdentity = sdkGrowthDatabaseIdentityDigest(
    releaseProbe.databaseIdentity,
  );
  const observerDatabaseIdentity = sdkGrowthDatabaseIdentityDigest(
    observation.databaseIdentity,
  );
  const expectedDatabaseIdentity =
    configuration.expectedDatabaseIdentity ?? releaseDatabaseIdentity;
  if (
    releaseDatabaseIdentity !== expectedDatabaseIdentity ||
    observerDatabaseIdentity !== expectedDatabaseIdentity ||
    releaseProbe.databaseIdentity?.sessionUser !== releaseRoleName ||
    releaseProbe.databaseIdentity?.currentUser !== releaseRoleName ||
    observation.databaseIdentity?.sessionUser !== observerRoleName ||
    observation.databaseIdentity?.currentUser !== observerRoleName
  )
    throw new Error("sdk_growth_schema_checkpoint_database_target_rejected");
  return Object.freeze({
    observation,
    releaseProbe,
    databaseIdentity: expectedDatabaseIdentity,
  });
}

export function executeSdkGrowthApplicationSchemaCheckpoint(env = process.env) {
  const headSha = checked("git", ["rev-parse", "HEAD"]);
  const configuration = validateSdkGrowthCheckpointEnvironment(env, headSha);
  const { observation, releaseProbe, databaseIdentity } =
    observeSdkGrowthApplicationSchemaCheckpoint(configuration);
  assertSdkGrowthApplicationSchemaCheckpoint(observation, {
    phase: configuration.phase,
  });
  return Object.freeze({
    kind: "reviewrouter-sdk-growth-application-schema-checkpoint",
    version: 2,
    phase: configuration.phase,
    releaseCommit: configuration.releaseCommit,
    predecessor: checkpointContract(configuration.phase).contract.predecessor,
    target: checkpointContract(configuration.phase).contract.target,
    postgresMajor: 17,
    databaseIdentity,
    releaseDatabaseRole: releaseProbe.currentUser,
    observerDatabaseRole: observation.currentUser,
    legacyRowCount: observation.legacyRowCount,
    checkpointProcessConfiguration: {
      sdkGrowthAuthorityEnabled: "0",
      outboxFencedTakeoverEnabled: "1",
    },
    deployedRuntimeConfiguration: "unverified",
    status: "passed",
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    process.stdout.write(
      `${JSON.stringify(executeSdkGrowthApplicationSchemaCheckpoint())}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `FAIL: ${error instanceof Error ? error.message : "sdk_growth_schema_checkpoint_failed"}\n`,
    );
    process.exitCode = 1;
  }
}
