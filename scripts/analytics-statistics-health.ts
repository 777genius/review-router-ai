import pg from "pg";
import { pathToFileURL } from "node:url";

type QueueStatus = "pending" | "processing" | "retry_wait" | "dead_letter";
type QueueRow = { status: string; count: string; oldest: Date | string | null };

/** Operator-only, read-only queue diagnostics. Never inspect event payloads. */
export function summarizeStatisticsQueue(rows: readonly QueueRow[]) {
  const counts: Record<QueueStatus, number> = {
    pending: 0,
    processing: 0,
    retry_wait: 0,
    dead_letter: 0,
  };
  let oldest: Date | null = null;
  for (const row of rows) {
    if (!Object.hasOwn(counts, row.status))
      throw new Error("unexpected_statistics_queue_status");
    const count = Number(row.count);
    if (!Number.isSafeInteger(count) || count < 0)
      throw new Error("invalid_statistics_queue_count");
    counts[row.status as QueueStatus] += count;
    if (row.status !== "dead_letter" && row.oldest) {
      const time = new Date(row.oldest);
      if (!Number.isFinite(time.getTime()))
        throw new Error("invalid_statistics_queue_timestamp");
      if (!oldest || time.getTime() < oldest.getTime()) oldest = time;
    }
  }
  return {
    outstanding: counts.pending + counts.processing + counts.retry_wait,
    deadLetters: counts.dead_letter,
    oldestOutstandingAt: oldest?.toISOString() ?? null,
    byStatus: counts,
  };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_required");
  const workspace = process.env.STATISTICS_WORKSPACE_ID ?? null;
  if (
    workspace !== null &&
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,255}$/.test(workspace)
  )
    throw new Error("invalid_statistics_workspace_id");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const scope = workspace ? ' AND "workspaceId"=$2' : "";
    const rows = await client.query<QueueRow>(
      `SELECT status::text AS status, COUNT(*)::text AS count,
              MIN("createdAt") AS oldest
         FROM "OutboxEvent"
        WHERE type=$1 AND version=1
          AND "workspaceId" IS NOT NULL
          AND status IN ('pending','processing','retry_wait','dead_letter')${scope}
        GROUP BY status`,
      workspace
        ? ["review.statistics.settled", workspace]
        : ["review.statistics.settled"],
    );
    const summary = summarizeStatisticsQueue(rows.rows);
    console.log(JSON.stringify(summary));
    if (summary.deadLetters) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    const code =
      error &&
      typeof error === "object" &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : "unknown";
    console.error("statistics_queue_check_failed", { code });
    process.exitCode = 2;
  });
}
