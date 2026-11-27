import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createPrismaClient } from "./index";

const execFileAsync = promisify(execFile);

/** A suite owns its migrated database; no shared application tables are changed. */
export async function createMigratedTestDatabase(adminUrl: string): Promise<{
  databaseUrl: string;
  cleanup: () => Promise<void>;
}> {
  const url = new URL(adminUrl);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  ) {
    throw new Error("disposable_loopback_database_required");
  }
  const template = process.env.RELIABILITY_TEST_POSTGRES_TEMPLATE_DATABASE;
  if (template && !/^[A-Za-z][A-Za-z0-9_]{0,62}$/u.test(template)) {
    throw new Error("reliability_invalid_template_name");
  }
  const admin = createPrismaClient({ databaseUrl: adminUrl, poolMax: 1 });
  const name = `TEST_reliability_${randomUUID().replaceAll("-", "")}`;
  try {
    await admin.$executeRawUnsafe(
      `CREATE DATABASE "${name}"${template ? ` TEMPLATE "${template}"` : ""}`,
    );
  } catch (error) {
    await admin.$disconnect();
    throw error;
  }
  url.pathname = `/${name}`;
  const cleanup = async () => {
    try {
      await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
    } finally {
      await admin.$disconnect();
    }
  };
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: url.toString(),
    PATH: `${fileURLToPath(new URL("../node_modules/.bin", import.meta.url))}${delimiter}${process.env.PATH ?? ""}`,
  };
  // A developer's credential-file setting must not override the owned fixture.
  delete environment.REVIEW_ROUTER_DATABASE_URL_FILE;
  try {
    // Migration roles are cluster-global. Shared CI clusters use the already
    // migrated template; a pristine single-suite cluster can migrate directly.
    if (!template) {
      await execFileAsync(process.execPath, ["scripts/migrate-deploy.mjs"], {
        cwd: fileURLToPath(new URL("../", import.meta.url)),
        env: environment,
        timeout: 120_000,
        maxBuffer: 4 * 1024 * 1024,
      });
    }
    return { databaseUrl: url.toString(), cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
