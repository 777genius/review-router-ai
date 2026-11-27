import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { webhookFenceDatabaseName } from "./postgres-fixture.ts";
import { combineWebhookFencePostgresResults, webhookFencePostgresSuites } from "./results.ts";
const root = fileURLToPath(new URL("../../", import.meta.url));
const configured = process.env.WEBHOOK_FENCE_TEST_POSTGRES_ADMIN_URL;
if (!configured) throw new Error("webhook_fence_test_admin_url_required");
const adminUrl = new URL(configured);
if (!['postgres:', 'postgresql:'].includes(adminUrl.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(adminUrl.hostname) || adminUrl.pathname !== '/postgres' || adminUrl.search !== '')
  throw new Error("webhook_fence_loopback_test_admin_required");
const databaseUrl = new URL(adminUrl);
databaseUrl.pathname = `/${webhookFenceDatabaseName}`;
databaseUrl.searchParams.set('schema', 'public');
const environment: NodeJS.ProcessEnv = {...process.env,
  PATH: `${join(root, 'node_modules/.bin')}${delimiter}${process.env.PATH ?? ''}`,
  DATABASE_URL: databaseUrl.href, REVIEW_ROUTER_WEBHOOK_FENCE_TEST_DATABASE_URL: databaseUrl.href,
};
delete environment.REVIEW_ROUTER_DATABASE_URL_FILE;
delete environment.REVIEW_ROUTER_WEBHOOK_FENCE_TEST_SOCKET;
mkdirSync(join(root, 'tmp'), {recursive: true});
const evidence = mkdtempSync(join(root, 'tmp/webhook-fencing-'));

const admin = new pg.Client({connectionString: adminUrl.href, connectionTimeoutMillis: 10_000, query_timeout: 10_000});
let created = false;
try {
  await admin.connect();
  const version = await admin.query('SHOW server_version_num');
  if (Number(version.rows[0]?.server_version_num) < 170000) throw new Error('webhook_fence_postgresql_17_required');
  // Never reuse or drop an existing database: it belongs to another run.
  await admin.query(`CREATE DATABASE "${webhookFenceDatabaseName}"`);
  created = true;
  const baseline = join(evidence, 'baseline');
  const dbPackage = join(root, 'packages/platform/db');
  mkdirSync(join(baseline, 'prisma/migrations'), {recursive: true});
  cpSync(join(dbPackage, 'prisma.config.ts'), join(baseline, 'prisma.config.ts'));
  cpSync(join(dbPackage, 'prisma/schema.prisma'), join(baseline, 'prisma/schema.prisma'));
  for (const name of readdirSync(join(dbPackage, 'prisma/migrations'))) {
    if (name === 'migration_lock.toml' || (/^\d{6}_/u.test(name) && name < '000165_'))
      cpSync(join(dbPackage, 'prisma/migrations', name), join(baseline, 'prisma/migrations', name), {recursive: true});
  }
  run([join(dbPackage, 'scripts/migrate-deploy.mjs')], baseline);
  const seed = new pg.Client({connectionString: databaseUrl.href});
  await seed.connect();
  try {
    await seed.query(`INSERT INTO "GitHubWebhookDelivery" (id,"deliveryId","eventName",status,"updatedAt")
      VALUES ('webhook-fence-migration-legacy','webhook-fence-migration-legacy','push','processing',CURRENT_TIMESTAMP)`);
  } finally {await seed.end();}
  run(['scripts/migrate-deploy.mjs'], dbPackage);
  const results: unknown[] = [];
  // A fresh process per suite releases Vite's native import graph between suites.
  for (const [index, suite] of webhookFencePostgresSuites.entries()) {
    const report = join(evidence, `postgres-results-${index}.json`);
    run(['node_modules/vitest/vitest.mjs', 'run', '--no-file-parallelism', '--maxWorkers=1', '--reporter=default', '--reporter=json', `--outputFile=${report}`, suite], root);
    results.push(JSON.parse(readFileSync(report, 'utf8')) as unknown);
  }
  console.log(JSON.stringify(combineWebhookFencePostgresResults(results)));
} finally {
  try {if (created) await admin.query(`DROP DATABASE "${webhookFenceDatabaseName}" WITH (FORCE)`);}
  finally {await admin.end();}
}
function run(args: string[], cwd: string) {
  const result = spawnSync(process.execPath, args, {cwd, env: environment, stdio: 'inherit', timeout: 10 * 60_000, killSignal: 'SIGKILL'});
  if (result.error || result.signal || result.status !== 0)
    throw new Error(`webhook_fence_postgres_command_failed:${result.signal ?? result.status ?? 'spawn'}`);
}
