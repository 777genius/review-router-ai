#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { runSecretSafePostgresCommand } from "./lib/secret-safe-command-boundary.mjs";
import {
  executeSdkGrowthApplicationSchemaCheckpoint,
  observeSdkGrowthDatabaseIdentity,
  sdkGrowthApplicationSchemaContract,
  sdkGrowthApplicationSchemaShape,
  sdkGrowthFinalizedReportShape,
} from "./sdk-growth-application-schema-checkpoint.mjs";

const coordinatorRole = "reviewrouter";
const schemaOwnerRole = "reviewrouter_release_schema_owner";
const releaseRole = sdkGrowthApplicationSchemaContract.releaseRole;
const observerRole = sdkGrowthApplicationSchemaContract.observerRole;
const advisoryLock = Object.freeze([1381126735, 1396983635]);

const operationContracts = Object.freeze({
  "apply-000105": sdkGrowthApplicationSchemaContract,
  "apply-000106": sdkGrowthApplicationSchemaContract.logicalIdentity,
});
const migrationPath = (contract) =>
  resolve(
    import.meta.dirname,
    `../packages/platform/db/prisma/migrations/${contract.target.migrationName}/migration.sql`,
  );
const sqlLiteral = (value) => `'${String(value).replaceAll("'", "''")}'`;

function required(env, name) {
  const value = env[name];
  if (!value) throw new Error(`sdk_growth_schema_executor_missing:${name}`);
  return value;
}

function parseDatabaseUrl(value, expectedRole) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("sdk_growth_schema_executor_database_role_rejected");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    decodeURIComponent(url.username) !== expectedRole ||
    !url.password ||
    !url.hostname ||
    !url.pathname.slice(1)
  )
    throw new Error("sdk_growth_schema_executor_database_role_rejected");
  return url;
}

export function validateSdkGrowthSchemaExecutorEnvironment(env, headSha) {
  const releaseCommit = required(env, "REVIEW_ROUTER_RELEASE_COMMIT_SHA");
  const configRevision = required(env, "REVIEW_ROUTER_RELEASE_CONFIG_REVISION");
  const apiRevision = required(env, "REVIEW_ROUTER_API_SERVICE_REVISION");
  const workerRevision = required(env, "REVIEW_ROUTER_WORKER_SERVICE_REVISION");
  const imageDigest = required(env, "REVIEW_ROUTER_RELEASE_IMAGE_DIGEST");
  const databaseIdentity = required(
    env,
    "REVIEW_ROUTER_SDK_GROWTH_DATABASE_IDENTITY",
  );
  const operationPhase = env.REVIEW_ROUTER_SDK_GROWTH_SCHEMA_OPERATION_PHASE;
  const contract = operationContracts[operationPhase];
  if (
    !contract ||
    !/^[a-f0-9]{40}$/u.test(releaseCommit) ||
    releaseCommit !== headSha ||
    configRevision !== releaseCommit ||
    apiRevision !== releaseCommit ||
    workerRevision !== releaseCommit ||
    !/^sha256:[a-f0-9]{64}$/u.test(imageDigest) ||
    !/^sha256:[a-f0-9]{64}$/u.test(databaseIdentity)
  )
    throw new Error("sdk_growth_schema_executor_release_binding_rejected");
  if (
    env.REVIEW_ROUTER_SDK_GROWTH_AUTHORITY_ENABLED !== "0" ||
    env.REVIEW_ROUTER_OUTBOX_FENCED_TAKEOVER_ENABLED !== "1"
  )
    throw new Error("sdk_growth_schema_executor_activation_hold_rejected");
  const coordinatorDatabaseUrl = parseDatabaseUrl(
    required(env, "REVIEW_ROUTER_SCHEMA_OWNER_COORDINATOR_DATABASE_URL"),
    coordinatorRole,
  );
  const releaseDatabaseUrl = parseDatabaseUrl(
    required(env, "REVIEW_ROUTER_RELEASE_MIGRATION_DATABASE_URL"),
    releaseRole,
  );
  const observerDatabaseUrl = parseDatabaseUrl(
    required(env, "REVIEW_ROUTER_SDK_GROWTH_SCHEMA_OBSERVER_DATABASE_URL"),
    observerRole,
  );
  const migration = readFileSync(migrationPath(contract));
  const migrationChecksum = createHash("sha256")
    .update(migration)
    .digest("hex");
  if (migrationChecksum !== contract.target.checksum)
    throw new Error("sdk_growth_schema_executor_source_checksum_rejected");
  return Object.freeze({
    releaseCommit,
    configRevision,
    apiRevision,
    workerRevision,
    imageDigest,
    databaseIdentity,
    operationPhase,
    contract,
    coordinatorDatabaseUrl,
    releaseDatabaseUrl,
    observerDatabaseUrl,
    migrationSql: migration.toString("utf8"),
  });
}

function functionSourceHash() {
  const source = readFileSync(
    migrationPath(sdkGrowthApplicationSchemaContract),
    "utf8",
  );
  const match =
    /CREATE FUNCTION sdk_growth_publication_preserve\(\) RETURNS trigger[\s\S]+?AS \$\$([\s\S]+?)\$\$;/u.exec(
      source,
    );
  if (!match?.[1])
    throw new Error("sdk_growth_schema_executor_source_function_rejected");
  return createHash("sha256").update(match[1]).digest("hex");
}

function verifierFunctionSourceHash() {
  const source = readFileSync(
    resolve(
      import.meta.dirname,
      "../packages/platform/db/prisma/migrations/000103_sdk_growth_authority_custody/migration.sql",
    ),
    "utf8",
  );
  const match =
    /CREATE FUNCTION sdk_growth_verifier_evidence_preserve\(\) RETURNS trigger[\s\S]+?AS \$\$([\s\S]+?)\$\$;/u.exec(
      source,
    );
  if (!match?.[1])
    throw new Error("sdk_growth_schema_executor_source_function_rejected");
  return createHash("sha256").update(match[1]).digest("hex");
}

function catalogDigest(rows, fields) {
  return createHash("sha256")
    .update(
      [...rows]
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((row) => fields.map((field) => row[field] ?? "").join("|"))
        .join("\n"),
    )
    .digest("hex");
}

const publicationColumnDigest = catalogDigest(
  sdkGrowthApplicationSchemaShape.columns,
  ["name", "type", "notNull", "default"],
);
const publicationConstraintDigest = catalogDigest(
  sdkGrowthApplicationSchemaShape.constraints,
  ["name", "type", "validated", "definition"],
);
const finalizedReportColumnDigest = catalogDigest(
  sdkGrowthFinalizedReportShape.columns,
  ["name", "type", "notNull", "default"],
);
const finalizedReportCatalogRejectedSql = `(SELECT count(*) FROM pg_attribute
  WHERE attrelid='public."SdkGrowthFinalizedReportEvidence"'::regclass
    AND attnum>0 AND NOT attisdropped) <> ${sdkGrowthFinalizedReportShape.columns.length}
OR (SELECT encode(pg_catalog.sha256(convert_to(string_agg(concat_ws('|',attribute.attname,
  format_type(attribute.atttypid,attribute.atttypmod),attribute.attnotnull::text,
  coalesce(pg_get_expr(default_row.adbin,default_row.adrelid),'')),E'\\n' ORDER BY attribute.attname),'UTF8')),'hex')
  FROM pg_attribute attribute LEFT JOIN pg_attrdef default_row
    ON default_row.adrelid=attribute.attrelid AND default_row.adnum=attribute.attnum
  WHERE attribute.attrelid='public."SdkGrowthFinalizedReportEvidence"'::regclass
    AND attribute.attnum>0 AND NOT attribute.attisdropped) <> '${finalizedReportColumnDigest}'
OR (SELECT count(*) FROM pg_trigger trigger_row
  JOIN pg_proc routine ON routine.oid=trigger_row.tgfoid
  JOIN pg_namespace namespace ON namespace.oid=routine.pronamespace
  WHERE trigger_row.tgrelid='public."SdkGrowthFinalizedReportEvidence"'::regclass
    AND trigger_row.tgname='sdk_growth_finalized_report_immutable'
    AND NOT trigger_row.tgisinternal AND trigger_row.tgenabled='O'
    AND trigger_row.tgtype::integer=58 AND trigger_row.tgattr::text=''
    AND trigger_row.tgqual IS NULL AND trigger_row.tgconstraint=0
    AND routine.oid='public.sdk_growth_verifier_evidence_preserve()'::regprocedure
    AND namespace.nspname='public' AND routine.proname='sdk_growth_verifier_evidence_preserve'
    AND routine.pronargs=0 AND routine.prorettype='trigger'::regtype) <> 1`;
const publicationCatalogRejectedSql = `(SELECT count(*) FROM pg_attribute
  WHERE attrelid='public."SdkGrowthPublicationEffect"'::regclass AND attnum>0 AND NOT attisdropped
    AND attname IN ('envelopeDigest','intent','attemptStartedAt','reconciliationCount','lastEvidence','outboxEventId','completedAt')) <> 7
OR (SELECT encode(pg_catalog.sha256(convert_to(string_agg(concat_ws('|',attribute.attname,
  format_type(attribute.atttypid,attribute.atttypmod),attribute.attnotnull::text,
  coalesce(pg_get_expr(default_row.adbin,default_row.adrelid),'')),E'\\n' ORDER BY attribute.attname),'UTF8')),'hex')
  FROM pg_attribute attribute LEFT JOIN pg_attrdef default_row ON default_row.adrelid=attribute.attrelid AND default_row.adnum=attribute.attnum
  WHERE attribute.attrelid='public."SdkGrowthPublicationEffect"'::regclass AND attribute.attnum>0 AND NOT attribute.attisdropped
    AND attribute.attname IN ('envelopeDigest','intent','attemptStartedAt','reconciliationCount','lastEvidence','outboxEventId','completedAt')) <> '${publicationColumnDigest}'
OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public."SdkGrowthPublicationEffect"'::regclass AND attnum>0 AND NOT attisdropped AND attname='providerCorrelation')
OR (SELECT count(*) FROM pg_constraint WHERE conrelid='public."SdkGrowthPublicationEffect"'::regclass AND convalidated
  AND conname IN ('SdkGrowthPublicationEffect_envelope_digest_check','SdkGrowthPublicationEffect_intent_check','SdkGrowthPublicationEffect_reconciliation_count_check','SdkGrowthPublicationEffect_shape_check','SdkGrowthPublicationEffect_state_check')) <> 5
OR (SELECT encode(pg_catalog.sha256(convert_to(string_agg(concat_ws('|',conname,contype,convalidated::text,
  pg_get_constraintdef(oid,false)),E'\\n' ORDER BY conname),'UTF8')),'hex') FROM pg_constraint
  WHERE conrelid='public."SdkGrowthPublicationEffect"'::regclass AND conname IN ('SdkGrowthPublicationEffect_envelope_digest_check','SdkGrowthPublicationEffect_intent_check','SdkGrowthPublicationEffect_reconciliation_count_check','SdkGrowthPublicationEffect_shape_check','SdkGrowthPublicationEffect_state_check')) <> '${publicationConstraintDigest}'
OR (SELECT count(*) FROM pg_trigger trigger_row JOIN pg_proc routine ON routine.oid=trigger_row.tgfoid
  JOIN pg_namespace namespace ON namespace.oid=routine.pronamespace
  WHERE trigger_row.tgrelid='public."SdkGrowthPublicationEffect"'::regclass AND NOT trigger_row.tgisinternal
    AND trigger_row.tgenabled='O' AND trigger_row.tgattr::text=''
    AND trigger_row.tgqual IS NULL AND trigger_row.tgconstraint=0
    AND routine.oid='public.sdk_growth_publication_preserve()'::regprocedure
    AND namespace.nspname='public' AND routine.proname='sdk_growth_publication_preserve'
    AND ((trigger_row.tgname='sdk_growth_publication_immutable' AND trigger_row.tgtype::integer=27) OR (trigger_row.tgname='sdk_growth_publication_no_truncate' AND trigger_row.tgtype::integer=34))) <> 2
OR NOT EXISTS (SELECT 1 FROM pg_index index_row JOIN pg_class relation ON relation.oid=index_row.indexrelid
  WHERE index_row.indrelid='public."SdkGrowthPublicationEffect"'::regclass AND relation.relname='SdkGrowthPublicationEffect_outbox_event_key'
    AND index_row.indisunique AND index_row.indisvalid AND index_row.indisready AND index_row.indislive
    AND index_row.indpred IS NULL AND index_row.indexprs IS NULL AND index_row.indnkeyatts=1
    AND (SELECT array_agg(attribute.attname ORDER BY key_row.ordinality) FROM unnest(index_row.indkey::smallint[]) WITH ORDINALITY key_row(attnum,ordinality)
      JOIN pg_attribute attribute ON attribute.attrelid=index_row.indrelid AND attribute.attnum=key_row.attnum WHERE key_row.ordinality<=index_row.indnkeyatts)=ARRAY['outboxEventId']::name[])
OR (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='public."SdkGrowthPublicationEffect"'::regclass) <> '${schemaOwnerRole}'
OR NOT EXISTS (SELECT 1 FROM pg_proc routine JOIN pg_namespace namespace ON namespace.oid=routine.pronamespace
  WHERE namespace.nspname='public' AND routine.proname='sdk_growth_publication_preserve' AND routine.pronargs=0
    AND pg_get_userbyid(routine.proowner)='${schemaOwnerRole}' AND NOT routine.prosecdef AND routine.provolatile='v'
    AND routine.proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[]
    AND encode(pg_catalog.sha256(convert_to(routine.prosrc,'UTF8')),'hex')='${functionSourceHash()}' AND NOT has_function_privilege('public',routine.oid,'EXECUTE'))`;

export function renderSdkGrowthSchemaExecutorSql({
  databaseIdentity,
  migrationSql,
  operationPhase = "apply-000105",
}) {
  const contract = operationContracts[operationPhase];
  if (!contract)
    throw new Error("sdk_growth_schema_executor_release_binding_rejected");
  if (
    databaseIdentity?.sessionUser !== coordinatorRole ||
    databaseIdentity?.currentUser !== coordinatorRole ||
    !/^[1-9][0-9]*$/u.test(databaseIdentity?.systemIdentifier ?? "") ||
    !/^[1-9][0-9]*$/u.test(databaseIdentity?.databaseOid ?? "") ||
    !/^[A-Za-z0-9_.-]{1,63}$/u.test(databaseIdentity?.databaseName ?? "")
  )
    throw new Error("sdk_growth_schema_executor_database_identity_rejected");
  const migrationChecksum = createHash("sha256")
    .update(migrationSql)
    .digest("hex");
  if (migrationChecksum !== contract.target.checksum)
    throw new Error("sdk_growth_schema_executor_source_checksum_rejected");
  const { predecessor, target } = contract;
  const logicalIdentity = operationPhase === "apply-000106";
  return `\\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
SELECT pg_advisory_xact_lock(${advisoryLock[0]},${advisoryLock[1]});
SET LOCAL search_path = pg_catalog, public;
DO $precondition$
DECLARE target_rows integer;
BEGIN
  IF current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
     OR session_user <> '${coordinatorRole}' OR current_user <> '${coordinatorRole}'
     OR (SELECT system_identifier::text FROM pg_control_system()) <> ${sqlLiteral(databaseIdentity.systemIdentifier)}
     OR (SELECT oid::text FROM pg_database WHERE datname=current_database()) <> ${sqlLiteral(databaseIdentity.databaseOid)}
     OR current_database() <> ${sqlLiteral(databaseIdentity.databaseName)}
     OR (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()) <> '${coordinatorRole}'
     OR (SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='public') <> '${schemaOwnerRole}'
     OR (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='public._prisma_migrations'::regclass) <> '${coordinatorRole}'
     ${
       logicalIdentity
         ? `OR (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='public."SdkGrowthFinalizedReportEvidence"'::regclass) <> '${schemaOwnerRole}'
     OR NOT EXISTS (SELECT 1 FROM pg_proc routine JOIN pg_namespace namespace ON namespace.oid=routine.pronamespace
       WHERE namespace.nspname='public' AND routine.proname='sdk_growth_verifier_evidence_preserve'
         AND routine.pronargs=0 AND pg_get_userbyid(routine.proowner)='${schemaOwnerRole}'
         AND routine.oid='public.sdk_growth_verifier_evidence_preserve()'::regprocedure
         AND routine.prorettype='trigger'::regtype
         AND NOT routine.prosecdef AND routine.provolatile='v'
         AND routine.proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[]
         AND encode(pg_catalog.sha256(convert_to(routine.prosrc,'UTF8')),'hex')='${verifierFunctionSourceHash()}'
         AND NOT has_function_privilege('public',routine.oid,'EXECUTE'))`
         : ""
     }
     OR EXISTS (SELECT 1 FROM (VALUES
       ('${schemaOwnerRole}',false),('${releaseRole}',true),('${observerRole}',true)
     ) expected(name,login) LEFT JOIN pg_roles role_row ON role_row.rolname=expected.name
       WHERE role_row.oid IS NULL OR role_row.rolcanlogin<>expected.login OR role_row.rolsuper
         OR role_row.rolcreatedb OR role_row.rolcreaterole OR role_row.rolreplication
         OR role_row.rolbypassrls)
     OR (SELECT count(*) FROM pg_auth_members membership
         WHERE membership.roleid='${schemaOwnerRole}'::regrole
           AND membership.member='${coordinatorRole}'::regrole
           AND membership.admin_option AND NOT membership.inherit_option
           AND NOT membership.set_option
           AND membership.grantor<>'${coordinatorRole}'::regrole) <> 1
     OR (SELECT count(*) FROM pg_auth_members membership
         WHERE membership.roleid='${schemaOwnerRole}'::regrole
           AND membership.member='${coordinatorRole}'::regrole) <> 1 THEN
    RAISE EXCEPTION 'sdk_growth_schema_executor_authority_or_target_rejected';
  END IF;
  IF (SELECT count(*) FROM public._prisma_migrations
      WHERE migration_name='${predecessor.migrationName}') <> 1
     OR NOT EXISTS (SELECT 1 FROM public._prisma_migrations
       WHERE migration_name='${predecessor.migrationName}'
         AND checksum='${predecessor.checksum}' AND finished_at IS NOT NULL
         AND rolled_back_at IS NULL AND applied_steps_count=1)
     OR EXISTS (SELECT 1 FROM public._prisma_migrations
       WHERE migration_name>'${target.migrationName}' AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'sdk_growth_schema_executor_predecessor_or_legacy_rejected';
  END IF;
  SELECT count(*) INTO target_rows FROM public._prisma_migrations
    WHERE migration_name='${target.migrationName}';
  IF target_rows NOT IN (0,1) OR (target_rows=1 AND NOT EXISTS (
    SELECT 1 FROM public._prisma_migrations
    WHERE migration_name='${target.migrationName}' AND checksum='${target.checksum}'
      AND finished_at IS NOT NULL AND rolled_back_at IS NULL AND applied_steps_count=1
  )) THEN
    RAISE EXCEPTION 'sdk_growth_schema_executor_target_ledger_rejected';
  END IF;
END
$precondition$;
SELECT NOT EXISTS (SELECT 1 FROM public._prisma_migrations
  WHERE migration_name='${target.migrationName}') AS apply_target \\gset
GRANT ${schemaOwnerRole} TO ${coordinatorRole}
  WITH ADMIN FALSE, INHERIT TRUE, SET TRUE GRANTED BY ${coordinatorRole};
SET LOCAL ROLE ${schemaOwnerRole};
SET LOCAL search_path = public, pg_catalog;
${logicalIdentity ? 'LOCK TABLE public."SdkGrowthFinalizedReportEvidence" IN ACCESS EXCLUSIVE MODE;' : ""}
DO $legacy_precondition$
BEGIN
  IF EXISTS (SELECT 1 FROM public.${logicalIdentity ? '"SdkGrowthFinalizedReportEvidence"' : '"SdkGrowthPublicationEffect"'}) THEN
    RAISE EXCEPTION 'sdk_growth_schema_executor_predecessor_or_legacy_rejected';
  END IF;
END
$legacy_precondition$;
${
  logicalIdentity
    ? `\\if :apply_target
DO $predecessor_catalog$
BEGIN
  IF ${publicationCatalogRejectedSql}
     OR ${finalizedReportCatalogRejectedSql}
     OR (SELECT encode(pg_catalog.sha256(convert_to(string_agg(conname||'='||pg_get_constraintdef(oid,false),E'\\n'
       ORDER BY conname),'UTF8')),'hex') FROM pg_constraint
       WHERE conrelid='public."SdkGrowthFinalizedReportEvidence"'::regclass AND convalidated)
       <> 'c8def03f86f42efc877f3f01af9cd55fcb9f253345ff0878ad8a4321900f8b83'
     OR NOT EXISTS (SELECT 1 FROM pg_index index_row JOIN pg_class relation ON relation.oid=index_row.indexrelid
       WHERE index_row.indrelid='public."SdkGrowthFinalizedReportEvidence"'::regclass
         AND relation.relname='SdkGrowthFinalizedReportEvidence_digest_key'
         AND index_row.indisunique AND index_row.indisvalid AND index_row.indisready AND index_row.indislive)
     THEN
    RAISE EXCEPTION 'sdk_growth_schema_executor_predecessor_catalog_rejected';
  END IF;
END
$predecessor_catalog$;
\\endif`
    : ""
}
\\if :apply_target
RESET ROLE;
INSERT INTO public._prisma_migrations(
  id,checksum,finished_at,migration_name,logs,rolled_back_at,started_at,applied_steps_count
) VALUES (
  gen_random_uuid()::text,'${target.checksum}',NULL,'${target.migrationName}',
  NULL,NULL,clock_timestamp(),0
);
SET LOCAL ROLE ${schemaOwnerRole};
SET LOCAL search_path = public, pg_catalog;
${migrationSql}
RESET ROLE;
UPDATE public._prisma_migrations SET finished_at=clock_timestamp(),applied_steps_count=1
WHERE migration_name='${target.migrationName}' AND checksum='${target.checksum}'
  AND finished_at IS NULL AND rolled_back_at IS NULL;
SET LOCAL ROLE ${schemaOwnerRole};
SET LOCAL search_path = public, pg_catalog;
\\endif
ALTER TABLE public."SdkGrowthPublicationEffect" OWNER TO ${schemaOwnerRole};
ALTER FUNCTION public.sdk_growth_publication_preserve() OWNER TO ${schemaOwnerRole};
REVOKE ALL ON FUNCTION public.sdk_growth_publication_preserve() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sdk_growth_verifier_evidence_preserve() FROM PUBLIC;
REVOKE ALL ON TABLE public."SdkGrowthPublicationEffect" FROM reviewrouter_api, reviewrouter_worker;
DO $runtime_columns$
DECLARE column_row record;
BEGIN
  FOR column_row IN SELECT attname FROM pg_attribute
    WHERE attrelid='public."SdkGrowthPublicationEffect"'::regclass
      AND attnum>0 AND NOT attisdropped
  LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES (%I) ON TABLE public."SdkGrowthPublicationEffect" FROM reviewrouter_api, reviewrouter_worker',column_row.attname);
  END LOOP;
END
$runtime_columns$;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public."SdkGrowthPublicationEffect"
  TO reviewrouter_api,reviewrouter_worker;
REVOKE ALL ON TABLE public."SdkGrowthPublicationEffect" FROM ${observerRole};
DO $observer_columns$
DECLARE column_row record;
BEGIN
  FOR column_row IN SELECT attname FROM pg_attribute
    WHERE attrelid='public."SdkGrowthPublicationEffect"'::regclass
      AND attnum>0 AND NOT attisdropped
  LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES (%I) ON TABLE public."SdkGrowthPublicationEffect" FROM ${observerRole}',column_row.attname);
  END LOOP;
END
$observer_columns$;
REVOKE CREATE ON SCHEMA public FROM ${observerRole};
GRANT USAGE ON SCHEMA public TO ${observerRole};
GRANT SELECT ON TABLE public."SdkGrowthPublicationEffect" TO ${observerRole};
REVOKE ALL ON TABLE public."SdkGrowthFinalizedReportEvidence" FROM ${observerRole};
DO $observer_report_columns$
DECLARE column_row record;
BEGIN
  FOR column_row IN SELECT attname FROM pg_attribute
    WHERE attrelid='public."SdkGrowthFinalizedReportEvidence"'::regclass
      AND attnum>0 AND NOT attisdropped
  LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES (%I) ON TABLE public."SdkGrowthFinalizedReportEvidence" FROM ${observerRole}',column_row.attname);
  END LOOP;
END
$observer_report_columns$;
GRANT SELECT ON TABLE public."SdkGrowthFinalizedReportEvidence" TO ${observerRole};
REVOKE ALL ON TABLE public."SdkGrowthPublicationEffect" FROM ${releaseRole};
RESET ROLE;
REVOKE ALL ON TABLE public._prisma_migrations FROM ${observerRole};
DO $observer_ledger_columns$
DECLARE column_row record;
BEGIN
  FOR column_row IN SELECT attname FROM pg_attribute
    WHERE attrelid='public._prisma_migrations'::regclass
      AND attnum>0 AND NOT attisdropped
  LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES (%I) ON TABLE public._prisma_migrations FROM ${observerRole}',column_row.attname);
  END LOOP;
END
$observer_ledger_columns$;
GRANT SELECT ON TABLE public._prisma_migrations TO ${observerRole};
GRANT SELECT ON TABLE public._prisma_migrations TO ${releaseRole};
DO $observer_memberships$
DECLARE edge record;
BEGIN
  FOR edge IN SELECT parent.rolname AS parent_name,grantor.rolname AS grantor_name
    FROM pg_auth_members membership
    JOIN pg_roles parent ON parent.oid=membership.roleid
    JOIN pg_roles grantor ON grantor.oid=membership.grantor
    WHERE membership.member='${observerRole}'::regrole
  LOOP
    EXECUTE format('REVOKE %I FROM ${observerRole} GRANTED BY %I RESTRICT',edge.parent_name,edge.grantor_name);
  END LOOP;
END
$observer_memberships$;
REVOKE ${schemaOwnerRole} FROM ${coordinatorRole}
  GRANTED BY ${coordinatorRole} RESTRICT;
-- sdk-growth-executor-before-postcondition
DO $postcondition$
BEGIN
  IF (SELECT count(*) FROM public._prisma_migrations
      WHERE migration_name='${target.migrationName}') <> 1
     OR NOT EXISTS (SELECT 1 FROM public._prisma_migrations
       WHERE migration_name='${target.migrationName}' AND checksum='${target.checksum}'
         AND finished_at IS NOT NULL AND rolled_back_at IS NULL AND applied_steps_count=1)
     OR ${publicationCatalogRejectedSql}
     OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member='${observerRole}'::regrole)
     OR has_schema_privilege('${observerRole}','public','CREATE')
     OR NOT has_schema_privilege('${observerRole}','public','USAGE')
     OR EXISTS (SELECT 1 FROM (VALUES
       ('public._prisma_migrations'::regclass),
       ('public."SdkGrowthFinalizedReportEvidence"'::regclass),
       ('public."SdkGrowthPublicationEffect"'::regclass)
     ) observed(relation_oid)
       WHERE NOT has_table_privilege('${observerRole}',relation_oid,'SELECT')
         OR has_table_privilege('${observerRole}',relation_oid,
           'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
     OR EXISTS (SELECT 1 FROM pg_attribute attribute
       WHERE attribute.attrelid IN (
         'public._prisma_migrations'::regclass,
         'public."SdkGrowthFinalizedReportEvidence"'::regclass,
         'public."SdkGrowthPublicationEffect"'::regclass)
         AND attribute.attnum>0 AND NOT attribute.attisdropped
         AND (has_column_privilege('${observerRole}',attribute.attrelid,attribute.attnum,'INSERT')
           OR has_column_privilege('${observerRole}',attribute.attrelid,attribute.attnum,'UPDATE')
           OR has_column_privilege('${observerRole}',attribute.attrelid,attribute.attnum,'REFERENCES')))
     OR EXISTS (SELECT 1 FROM (VALUES ('reviewrouter_api'),('reviewrouter_worker')) runtime(role_name)
       WHERE NOT has_table_privilege(role_name,'public."SdkGrowthPublicationEffect"','SELECT,INSERT,UPDATE,DELETE')
         OR has_table_privilege(role_name,'public."SdkGrowthPublicationEffect"','TRUNCATE,REFERENCES,TRIGGER'))
     OR (SELECT count(*) FROM pg_auth_members membership
         WHERE membership.roleid='${schemaOwnerRole}'::regrole
           AND membership.member='${coordinatorRole}'::regrole
           AND membership.admin_option AND NOT membership.inherit_option
           AND NOT membership.set_option
           AND membership.grantor<>'${coordinatorRole}'::regrole) <> 1
     OR (SELECT count(*) FROM pg_auth_members membership
         WHERE membership.roleid='${schemaOwnerRole}'::regrole
           AND membership.member='${coordinatorRole}'::regrole) <> 1
     ${
       logicalIdentity
         ? `OR ${finalizedReportCatalogRejectedSql}
     OR EXISTS (SELECT 1 FROM pg_constraint
       WHERE conrelid='public."SdkGrowthFinalizedReportEvidence"'::regclass
         AND conname='SdkGrowthFinalizedReportEvidence_digest_key')
     OR EXISTS (SELECT 1 FROM pg_index index_row JOIN pg_class relation ON relation.oid=index_row.indexrelid
       WHERE index_row.indrelid='public."SdkGrowthFinalizedReportEvidence"'::regclass
         AND (relation.relname='SdkGrowthFinalizedReportEvidence_digest_key'
           OR (index_row.indisunique AND (SELECT array_agg(attribute.attname ORDER BY key_row.ordinality)
             FROM unnest(index_row.indkey::smallint[]) WITH ORDINALITY key_row(attnum,ordinality)
             JOIN pg_attribute attribute ON attribute.attrelid=index_row.indrelid
               AND attribute.attnum=key_row.attnum
             WHERE key_row.ordinality<=index_row.indnkeyatts)
             = ARRAY['evidenceId','reportDigest']::name[])))
     OR (SELECT encode(pg_catalog.sha256(convert_to(string_agg(conname||'='||pg_get_constraintdef(oid,false),E'\\n'
       ORDER BY conname),'UTF8')),'hex') FROM pg_constraint
       WHERE conrelid='public."SdkGrowthFinalizedReportEvidence"'::regclass AND convalidated)
       <> '3546009d14d16a6a0fa67e0911028c335a35accf948bbe10f460b203490ba24b'
     `
         : ""
     } THEN
    RAISE EXCEPTION 'sdk_growth_schema_executor_postcondition_rejected';
  END IF;
END
$postcondition$;
-- sdk-growth-executor-before-commit
SELECT json_build_object('outcome',CASE WHEN :'apply_target'::boolean THEN 'applied' ELSE 'already-committed' END,
  'target','${target.migrationName}','checksum','${target.checksum}') AS operation_result \\gset
COMMIT;
SELECT :'operation_result';`;
}

function checkedHead() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
    timeout: 30_000,
  });
  if (result.status !== 0 || result.error)
    throw new Error("sdk_growth_schema_executor_git_rejected");
  return result.stdout.trim();
}

function sameTarget(expected, observations) {
  if (
    observations.some(
      (identity) =>
        identity.digest !== expected ||
        identity.postgresVersion < 170000 ||
        identity.postgresVersion >= 180000,
    )
  )
    throw new Error("sdk_growth_schema_executor_database_target_rejected");
}

export function executeSdkGrowthApplicationSchema(env = process.env) {
  const configuration = validateSdkGrowthSchemaExecutorEnvironment(
    env,
    checkedHead(),
  );
  const coordinatorIdentity = observeSdkGrowthDatabaseIdentity(
    configuration.coordinatorDatabaseUrl,
  );
  const releaseIdentity = observeSdkGrowthDatabaseIdentity(
    configuration.releaseDatabaseUrl,
  );
  const observerIdentity = observeSdkGrowthDatabaseIdentity(
    configuration.observerDatabaseUrl,
  );
  sameTarget(configuration.databaseIdentity, [
    coordinatorIdentity,
    releaseIdentity,
    observerIdentity,
  ]);
  if (
    coordinatorIdentity.sessionUser !== coordinatorRole ||
    coordinatorIdentity.currentUser !== coordinatorRole ||
    releaseIdentity.sessionUser !== releaseRole ||
    releaseIdentity.currentUser !== releaseRole ||
    observerIdentity.sessionUser !== observerRole ||
    observerIdentity.currentUser !== observerRole
  )
    throw new Error("sdk_growth_schema_executor_database_role_rejected");
  const sql = renderSdkGrowthSchemaExecutorSql({
    databaseIdentity: coordinatorIdentity,
    migrationSql: configuration.migrationSql,
    operationPhase: configuration.operationPhase,
  });
  const { stdout } = runSecretSafePostgresCommand({
    databaseUrl: configuration.coordinatorDatabaseUrl,
    args: ["--no-psqlrc", "--quiet", "--tuples-only", "--no-align"],
    input: sql,
    timeoutMs: 180_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  let operation;
  try {
    operation = JSON.parse(stdout.trim());
  } catch {
    throw new Error("sdk_growth_schema_executor_result_rejected");
  }
  if (
    !["applied", "already-committed"].includes(operation?.outcome) ||
    operation.target !== configuration.contract.target.migrationName ||
    operation.checksum !== configuration.contract.target.checksum
  )
    throw new Error("sdk_growth_schema_executor_result_rejected");
  const checkpoint = executeSdkGrowthApplicationSchemaCheckpoint({
    ...env,
    REVIEW_ROUTER_SDK_GROWTH_SCHEMA_CHECKPOINT_PHASE:
      configuration.operationPhase === "apply-000106"
        ? "postflight-000106"
        : "postflight",
  });
  if (checkpoint.databaseIdentity !== configuration.databaseIdentity)
    throw new Error("sdk_growth_schema_executor_postflight_target_rejected");
  return Object.freeze({
    kind: "reviewrouter-sdk-growth-application-schema-execution",
    version: 2,
    phase: configuration.operationPhase,
    outcome: operation.outcome,
    releaseCommit: configuration.releaseCommit,
    migration: configuration.contract.target,
    databaseIdentity: configuration.databaseIdentity,
    releaseImageDigest: configuration.imageDigest,
    releaseConfigRevision: configuration.configRevision,
    apiServiceRevision: configuration.apiRevision,
    workerServiceRevision: configuration.workerRevision,
    postgresMajor: 17,
    authorityConfiguration: "disabled",
    activationStatus: "HOLD",
    activationRemainingGate:
      "trusted-ingestion-provider-enforcement-fleet-and-app-first-qualification",
    checkpoint,
    status: "passed",
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    process.stdout.write(
      `${JSON.stringify(executeSdkGrowthApplicationSchema())}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `FAIL: ${error instanceof Error ? error.message : "sdk_growth_schema_executor_failed"}\n`,
    );
    process.exitCode = 1;
  }
}
