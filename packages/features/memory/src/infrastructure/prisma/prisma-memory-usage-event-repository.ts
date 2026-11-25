import { Prisma, type PrismaClient } from "@prisma/client";
import type { MemoryUsageEventRetentionPort } from "../../application/ports/memory-usage-event-retention-port";

/** Retains historical usage telemetry without retaining a canonical content store. */
export class PrismaMemoryUsageEventRepository implements MemoryUsageEventRetentionPort {
  constructor(
    private readonly prisma: PrismaClient | Prisma.TransactionClient,
  ) {}

  async pruneBefore(
    input: Parameters<MemoryUsageEventRetentionPort["pruneBefore"]>[0],
  ): ReturnType<MemoryUsageEventRetentionPort["pruneBefore"]> {
    const workspaceFilter =
      input.scope.kind === "workspace"
        ? Prisma.sql`AND "workspaceId" = ${input.scope.workspaceId}`
        : Prisma.empty;
    const deletedRows = await this.prisma.$queryRaw<{ readonly id: string }[]>`
      WITH expired AS (
        SELECT "id"
        FROM "MemoryUsageEvent"
        WHERE "occurredAt" < ${input.occurredBefore}
        ${workspaceFilter}
        ORDER BY "occurredAt" ASC, "id" ASC
        LIMIT ${input.limit}
      )
      DELETE FROM "MemoryUsageEvent"
      USING expired
      WHERE "MemoryUsageEvent"."id" = expired."id"
      RETURNING "MemoryUsageEvent"."id"
    `;
    return { deletedCount: deletedRows.length };
  }
}
