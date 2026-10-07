#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

export const anchor = "000104_hosted_pool_request_scoped_failover";
export const targetMigrations = Object.freeze([
  "000105_sdk_growth_publication_effect",
  "000106_sdk_growth_finalized_report_logical_identity",
  "000107_hosted_v4_relay_turn_contract",
  "000108_sdk_growth_verifier_assignment",
  "000109_sdk_growth_verifier_assignment_lock",
  "000110_provider_api_key_workspace_management",
]);
const migrationDirectory = resolve("packages/platform/db/prisma/migrations");
const expectedDatabase = "review_router_dimy";
const expectedHost =
  /^dpg-da32ipmk1f9s73dttm90-a(?:\.[a-z0-9-]+-postgres\.render\.com)?$/u;

export function assertTargetDatabase(databaseUrl, observedDatabase) {
  if (!databaseUrl) throw new Error("production_migration_url_missing");
  const url = new URL(databaseUrl);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !expectedHost.test(url.hostname) ||
    url.pathname !== `/${expectedDatabase}` ||
    (url.port && url.port !== "5432") ||
    observedDatabase !== expectedDatabase
  ) {
    throw new Error("production_migration_database_identity_mismatch");
  }
}

export function assertMigrationSessionUser(
  sessionUser,
  currentUser = sessionUser,
) {
  if (sessionUser !== "reviewrouter" || currentUser !== "reviewrouter")
    throw new Error("production_migration_role_mismatch");
}

export function planProductionAdditiveMigrations({
  catalog,
  rows,
  checksums,
  postflight = false,
}) {
  const anchorIndex = catalog.indexOf(anchor);
  if (
    anchorIndex < 0 ||
    JSON.stringify(catalog.slice(anchorIndex)) !==
      JSON.stringify([anchor, ...targetMigrations])
  ) {
    throw new Error("production_migration_catalog_outside_window");
  }
  const successful = rows.filter(
    (row) => row.finished_at != null && row.rolled_back_at == null,
  );
  const unresolved = rows.some(
    (row) => row.finished_at == null && row.rolled_back_at == null,
  );
  const applied = successful.map((row) => row.migration_name);
  if (
    unresolved ||
    rows.some((row) => !catalog.includes(row.migration_name)) ||
    applied.length < anchorIndex + 1 ||
    applied.length > catalog.length ||
    JSON.stringify(applied) !== JSON.stringify(catalog.slice(0, applied.length))
  ) {
    throw new Error("production_migration_ledger_outside_window");
  }
  for (const row of successful) {
    if (row.checksum !== checksums.get(row.migration_name)) {
      throw new Error("production_migration_checksum_mismatch");
    }
  }
  const pending = catalog.slice(applied.length);
  if (postflight && pending.length > 0)
    throw new Error("production_migration_postflight_incomplete");
  return Object.freeze({ applied, pending });
}

export function stripMigrationTransaction(source, name) {
  const lines = source.split("\n");
  const significant = lines
    .map((line, index) => ({ line: line.trim(), index }))
    .filter(({ line }) => line && !line.startsWith("--"));
  const begin = significant.filter(({ line }) => line === "BEGIN;");
  const commit = significant.filter(({ line }) => line === "COMMIT;");
  if (begin.length === 0 && commit.length === 0) return source;
  if (
    begin.length !== 1 ||
    commit.length !== 1 ||
    significant[0]?.index !== begin[0].index ||
    significant.at(-1)?.index !== commit[0].index
  ) {
    throw new Error(
      `production_migration_transaction_envelope_invalid:${name}`,
    );
  }
  return lines
    .filter((_, index) => index !== begin[0].index && index !== commit[0].index)
    .join("\n");
}

async function localCatalog() {
  const catalog = (await readdir(migrationDirectory))
    .filter((name) => /^\d{6}_[a-z0-9_]+$/u.test(name))
    .sort();
  const checksums = new Map();
  const sources = new Map();
  for (const name of catalog) {
    const source = await readFile(
      resolve(migrationDirectory, name, "migration.sql"),
      "utf8",
    );
    checksums.set(name, createHash("sha256").update(source).digest("hex"));
    if (targetMigrations.includes(name))
      sources.set(name, stripMigrationTransaction(source, name));
  }
  return { catalog, checksums, sources };
}

async function inspect(client, databaseUrl, local, phase) {
  const identity = await client.query(
    "SELECT current_database() AS database_name, current_setting('server_version_num') AS server_version_num, session_user AS session_user, current_user AS current_user",
  );
  assertTargetDatabase(databaseUrl, identity.rows[0]?.database_name);
  if (
    Number(identity.rows[0]?.server_version_num) < 170_000 ||
    Number(identity.rows[0]?.server_version_num) >= 180_000
  ) {
    throw new Error("production_migration_postgres_version_unsupported");
  }
  assertMigrationSessionUser(
    identity.rows[0]?.session_user,
    identity.rows[0]?.current_user,
  );
  const ledger = await client.query(
    'SELECT migration_name, checksum, finished_at, rolled_back_at FROM public."_prisma_migrations" ORDER BY migration_name, started_at',
  );
  return planProductionAdditiveMigrations({
    catalog: local.catalog,
    rows: ledger.rows,
    checksums: local.checksums,
    postflight: phase === "postflight",
  });
}

async function apply(client, databaseUrl, local) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL lock_timeout = '5000ms'");
    await client.query("SET LOCAL statement_timeout = '120000ms'");
    await client.query("SET LOCAL search_path = public, pg_catalog");
    await client.query("SELECT pg_advisory_xact_lock(1381126735, 109)");
    const before = await inspect(client, databaseUrl, local, "apply");
    for (const name of before.pending) {
      const checksum = local.checksums.get(name);
      await client.query(
        `INSERT INTO public."_prisma_migrations"
         (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
         VALUES ($1, $2, NULL, $3, NULL, NULL, clock_timestamp(), 0)`,
        [randomUUID(), checksum, name],
      );
      await client.query(local.sources.get(name));
      const result = await client.query(
        `UPDATE public."_prisma_migrations"
         SET finished_at = clock_timestamp(), applied_steps_count = 1
         WHERE migration_name = $1 AND checksum = $2
           AND finished_at IS NULL AND rolled_back_at IS NULL`,
        [name, checksum],
      );
      if (result.rowCount !== 1)
        throw new Error("production_migration_ledger_update_mismatch");
    }
    const after = await inspect(client, databaseUrl, local, "apply");
    if (after.pending.length !== 0)
      throw new Error("production_migration_postflight_incomplete");
    await client.query("COMMIT");
    return { applied: before.pending, pending: [] };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function run(phase, databaseUrl) {
  if (!databaseUrl) throw new Error("production_migration_url_missing");
  const local = phase === "reachability" ? null : await localCatalog();
  const client = new pg.Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 10_000,
    query_timeout: 125_000,
    application_name: "reviewrouter-production-additive-migration-window",
  });
  await client.connect();
  try {
    if (phase === "reachability") {
      await client.query("SELECT 1");
      return { reachable: true };
    }
    return phase === "apply"
      ? await apply(client, databaseUrl, local)
      : await inspect(client, databaseUrl, local, phase);
  } finally {
    await client.end();
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  const phase = process.argv[2];
  if (!["reachability", "preflight", "apply", "postflight"].includes(phase))
    throw new Error("production_migration_phase_invalid");
  run(phase, process.env.DATABASE_URL)
    .then((result) => console.log(JSON.stringify({ phase, ...result })))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
