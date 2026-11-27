import { Prisma, type PrismaClient } from "@prisma/client";

const batchSize = 1000;
const passBudgetMs = 4000;
const maxPasses = 4;

/** One bounded indexed pass per table; concurrent replicas skip owned rows. */
export async function pruneUsageRetention(
  prisma: PrismaClient,
  now: Date,
): Promise<void> {
  const started = performance.now();
  const tables = [
    [
      "UsageUnattributedObservation",
      "receivedAt",
      new Date(now.getTime() - 35 * 86400000),
    ],
    ["UsageSourceFact", "receivedAt", new Date(now.getTime() - 90 * 86400000)],
    ["UsageCall", "occurredAt", new Date(now.getTime() - 365 * 86400000)],
    ["UsageDedupeTombstone", "expiresAt", now],
  ] as const;
  for (let pass = 0; pass < maxPasses; pass++) {
    const counts = await prisma.$transaction(
      async (tx) => {
        // These limits belong only to this maintenance transaction.
        await tx.$queryRaw`SELECT set_config('statement_timeout','1000ms',true), set_config('lock_timeout','100ms',true)`;
        const deleted: number[] = [];
        for (const [name, dateColumn, cutoff] of tables) {
          // Identifiers come only from the closed table list above.
          const table = Prisma.raw(`"${name}"`);
          const date = Prisma.raw(`"${dateColumn}"`);
          deleted.push(
            await tx.$executeRaw(Prisma.sql`
          WITH expired AS (
            SELECT ctid FROM ${table} WHERE ${date}<${cutoff}
            ORDER BY ${date} LIMIT ${batchSize} FOR UPDATE SKIP LOCKED
          ) DELETE FROM ${table} AS target USING expired
            WHERE target.ctid=expired.ctid AND target.${date}<${cutoff}`),
          );
        }
        return deleted;
      },
      { maxWait: 1000, timeout: 5000 },
    );
    if (
      counts.every((count) => count < batchSize) ||
      performance.now() - started >= passBudgetMs
    )
      return;
  }
}
