#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import pg from "pg";

const { Client } = pg;

export const MIN_SUPPORTED_POSTGRES_MAJOR = 17;
export const MIGRATION_PREFLIGHT_TIMEOUT_MS = 10_000;

export function resolveMigrationDatabaseUrl(
  environment = process.env,
  readFile = readFileSync,
) {
  const credentialPath = environment.REVIEW_ROUTER_DATABASE_URL_FILE;
  if (credentialPath) return readFile(credentialPath, "utf8").trim();
  return environment.DATABASE_URL;
}

export function postgresMajor(serverVersionNum) {
  const serialized = String(serverVersionNum);
  if (!/^\d+$/u.test(serialized)) {
    throw new Error("reviewrouter_migrate_postgres_version_invalid");
  }
  const parsed = Number.parseInt(serialized, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 10_000) {
    throw new Error("reviewrouter_migrate_postgres_version_invalid");
  }
  return Math.floor(parsed / 10_000);
}

export function assertSupportedPostgresVersion(serverVersionNum) {
  const major = postgresMajor(serverVersionNum);
  if (major < MIN_SUPPORTED_POSTGRES_MAJOR) {
    throw new Error(
      `reviewrouter_migrate_postgres_version_unsupported: required>=${MIN_SUPPORTED_POSTGRES_MAJOR} actual=${major}`,
    );
  }
  return major;
}

async function inspectPostgresVersion(databaseUrl) {
  const client = new Client({
    connectionString: databaseUrl,
    application_name: "reviewrouter-migration-preflight",
    connectionTimeoutMillis: MIGRATION_PREFLIGHT_TIMEOUT_MS,
    query_timeout: MIGRATION_PREFLIGHT_TIMEOUT_MS,
  });
  await client.connect();
  try {
    const result = await client.query("SHOW server_version_num");
    return result.rows[0]?.server_version_num;
  } finally {
    await client.end();
  }
}

async function runPrismaMigrateDeploy(databaseUrl) {
  const {
    REVIEW_ROUTER_DATABASE_URL_FILE: _credentialFile,
    ...migrationEnvironment
  } = process.env;
  await new Promise((resolve, reject) => {
    const child = spawn(
      "prisma",
      ["migrate", "deploy", "--config", "prisma.config.ts"],
      {
        env: { ...migrationEnvironment, DATABASE_URL: databaseUrl },
        shell: false,
        stdio: "inherit",
      },
    );
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`prisma_migrate_deploy_signal:${signal}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`prisma_migrate_deploy_exit:${code ?? "unknown"}`));
        return;
      }
      resolve();
    });
  });
}

export async function migrateDeploy({
  databaseUrl = resolveMigrationDatabaseUrl(),
  inspectVersion = inspectPostgresVersion,
  runMigration = runPrismaMigrateDeploy,
} = {}) {
  if (!databaseUrl) {
    throw new Error("reviewrouter_migrate_database_url_missing");
  }
  const major = assertSupportedPostgresVersion(
    await inspectVersion(databaseUrl),
  );
  console.log(
    `ReviewRouter migration preflight: PostgreSQL ${major} accepted.`,
  );
  await runMigration(databaseUrl);
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  migrateDeploy().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
