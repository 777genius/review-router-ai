import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
const execFileAsync = promisify(execFile);
/** Each suite owns one disposable database; the optional template is already fully migrated. */
export async function createHistoryDatabase(
  adminUrl: string,
  options: {
    onQuery?: (event: { query: string; params: string }) => void;
  } = {},
): Promise<{ prisma: PrismaClient; cleanup: () => Promise<void> }> {
  const url = new URL(adminUrl);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  )
    throw new Error("history_disposable_loopback_database_required");
  const admin = new PrismaClient({
    adapter: new PrismaPg({ connectionString: adminUrl }),
  });
  const name = `TEST_history_${randomUUID().replaceAll("-", "")}`;
  const template = process.env.HISTORY_TEST_POSTGRES_TEMPLATE_DATABASE;
  if (template && !/^[A-Za-z][A-Za-z0-9_]{0,62}$/u.test(template))
    throw new Error("history_invalid_template_name");
  await admin.$executeRawUnsafe(
    `CREATE DATABASE "${name}"${template ? ` TEMPLATE "${template}"` : ""}`,
  );
  url.pathname = `/${name}`;
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url.toString(), max: 8 }),
    log: [{ emit: "event", level: "query" }],
  });
  prisma.$on("query", (event) => options.onQuery?.(event));
  const cleanup = async () => {
    await prisma.$disconnect();
    await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.$disconnect();
  };
  try {
    if (!template) {
      await execFileAsync(process.execPath, ["scripts/migrate-deploy.mjs"], {
        cwd: fileURLToPath(
          new URL("../../../../platform/db/", import.meta.url),
        ),
        env: { ...process.env, DATABASE_URL: url.toString() },
        maxBuffer: 4 * 1024 * 1024,
      });
    }
    await prisma.$queryRaw`SELECT "coverageSince" FROM "ReviewHistoryCoverage" LIMIT 1`;
    return { prisma, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
