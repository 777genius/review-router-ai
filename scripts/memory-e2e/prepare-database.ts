/** Prepare only an explicitly named, empty, loopback test database. */
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import pg from "pg";

const databaseUrl = process.env.MEMORY_E2E_DATABASE_URL;
if (!databaseUrl) throw new Error("MEMORY_E2E_DATABASE_URL is required");
const url = new URL(databaseUrl);
const names = new Set([
  "/reviewrouter_memory_test",
  "/reviewrouter_memory_api_test",
  "/reviewrouter_memory_browser_test",
]);
if (
  !["postgres:", "postgresql:"].includes(url.protocol) ||
  !["127.0.0.1", "localhost"].includes(url.hostname) ||
  !names.has(url.pathname) ||
  url.search !== "" ||
  url.hash !== ""
) {
  throw new Error("memory_e2e_requires_named_loopback_test_database");
}
const root = fileURLToPath(new URL("../../", import.meta.url));
const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  const result = await client.query<{ tables: number; version: number }>(`
    SELECT (SELECT count(*)::int FROM pg_tables WHERE schemaname = 'public') AS tables,
      current_setting('server_version_num')::int AS version`);
  if (result.rows[0]?.tables !== 0 || result.rows[0].version < 170_000) {
    throw new Error("memory_e2e_requires_empty_postgres_17_database");
  }
  const child = spawnSync(
    "pnpm",
    [
      "--filter",
      "@reviewrouter/platform-db",
      "exec",
      "prisma",
      "db",
      "push",
      "--config",
      "prisma.config.ts",
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        REVIEW_ROUTER_DATABASE_URL_FILE: "",
      },
      stdio: "inherit",
    },
  );
  if (child.error || child.status !== 0)
    throw new Error("memory_e2e_schema_setup_failed");
  const migrationRoot = resolve(root, "packages/platform/db/prisma/migrations");
  // Prisma models do not encode SQL checks or the outbox fencing trigger. Apply
  // the actual affected SQL to empty tables after establishing the full schema.
  const projectionMigration = await readFile(
    resolve(migrationRoot, "000141_memory_search_projections/migration.sql"),
    "utf8",
  );
  const initial = await readFile(
    resolve(migrationRoot, "000001_init/migration.sql"),
    "utf8",
  );
  const outboxTable = initial.match(
    /CREATE TABLE "OutboxEvent" \([\s\S]*?\n\);/u,
  )?.[0];
  const outboxIndexes = initial.match(
    /CREATE (?:UNIQUE )?INDEX "OutboxEvent_[^;]+;/gu,
  );
  if (!outboxTable || !outboxIndexes?.length)
    throw new Error("memory_e2e_outbox_source_shape_changed");
  const outboxFencing = await readFile(
    resolve(migrationRoot, "000028_outbox_claim_fencing/migration.sql"),
    "utf8",
  );
  await client.query("BEGIN");
  try {
    await client.query('DROP TABLE "MemoryProjectionReceipt"');
    await client.query(projectionMigration);
    await client.query(
      'DROP TABLE "OutboxEvent"; DROP TABLE "OutboxFencingControl"',
    );
    await client.query(
      `${outboxTable}\n${outboxIndexes.join("\n")}\n${outboxFencing}`,
    );
    await client.query(
      'UPDATE "OutboxFencingControl" SET "enabled" = true WHERE "id" = 1',
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  console.log(
    JSON.stringify({
      database: url.pathname.slice(1),
      schema: "current Prisma models",
      actualMigrations: [
        "000028_outbox_claim_fencing",
        "000141_memory_search_projections",
      ],
      historicalReplay: false,
    }),
  );
} finally {
  await client.end();
}
