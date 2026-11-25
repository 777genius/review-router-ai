import { readFile } from "node:fs/promises";
import { createPrismaClient } from "../packages/platform/db/src/index.js";
import { createReviewHistoryFeature } from "../packages/features/review-history/src/composition/index.js";

async function main(): Promise<void> {
  if (process.argv.slice(2).join(" ") !== "--confirm-writers-ready") {
    throw new Error(
      "Usage: history:activate --confirm-writers-ready (all API and worker capture hooks must already be ready)",
    );
  }
  const credentialPath = process.env.REVIEW_ROUTER_DATABASE_URL_FILE;
  const databaseUrl = credentialPath
    ? (await readFile(credentialPath, "utf8")).trim()
    : process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("review_history_database_url_required");
  const prisma = createPrismaClient({ databaseUrl });
  try {
    const feature = await createReviewHistoryFeature({ prisma });
    const coverageSince = await feature.activateCapture();
    console.log(
      `Review history capture activated: ${coverageSince.toISOString()}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((error: unknown) => {
  console.error(
    error instanceof Error && error.message.startsWith("Usage:")
      ? error.message
      : "Review history activation failed",
  );
  process.exitCode = 1;
});
