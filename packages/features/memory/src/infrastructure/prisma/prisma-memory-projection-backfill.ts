import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { MemoryIndexOperationError } from "../../application/ports/memory-search-index-port";
import { PrismaMemoryOutbox } from "./prisma-memory-outbox";

export type MemoryProjectionBackfillInput = {
  readonly limit?: number;
  readonly afterId?: string;
};

export type MemoryProjectionBackfillResult = {
  readonly scanned: number;
  readonly enqueued: number;
  readonly nextCursor: string | null;
};

type BackfillRevision = {
  readonly id: string;
  readonly workspaceId: string;
  readonly repositoryId: string | null;
  readonly bodyVersion: number;
  readonly bodyHash: string;
};

/** Page canonical IDs/revisions only; the ordinary outbox reloads text at send. */
export async function enqueueMemoryProjectionBackfill(
  prisma: PrismaClient,
  indexIdentity: string,
  input: MemoryProjectionBackfillInput = {},
): Promise<MemoryProjectionBackfillResult> {
  const limit = input.limit ?? 100;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 500 ||
    (input.afterId !== undefined &&
      (!input.afterId.trim() || input.afterId.length > 256))
  ) {
    throw new MemoryIndexOperationError("memory_projection_backfill_invalid");
  }
  const after =
    input.afterId === undefined
      ? Prisma.empty
      : Prisma.sql`AND "id" > ${input.afterId}`;
  const records = await prisma.$queryRaw<BackfillRevision[]>(Prisma.sql`
    SELECT "id", "workspaceId", "repositoryId", "bodyVersion", "bodyHash"
    FROM "MemoryItem"
    WHERE "status" = 'active'
      AND ("expiresAt" IS NULL OR "expiresAt" > CURRENT_TIMESTAMP)
      ${after}
    ORDER BY "id" ASC LIMIT ${limit + 1}`);
  const page = records.slice(0, limit);
  const outbox = new PrismaMemoryOutbox(prisma);
  let enqueued = 0;
  for (const revision of page) {
    const identity = createHash("sha256")
      .update(
        JSON.stringify([
          indexIdentity,
          revision.workspaceId,
          revision.id,
          revision.bodyVersion,
          revision.bodyHash,
        ]),
      )
      .digest("hex");
    const result = await outbox.enqueue({
      type: "memory.embedding.reindex.requested",
      version: 1,
      idempotencyKey: "memory.embedding.backfill:" + identity,
      workspaceId: revision.workspaceId,
      repositoryId: revision.repositoryId,
      aggregateId: revision.id,
      occurredAt: new Date(),
      payload: {
        bodyVersion: revision.bodyVersion,
        bodyHash: revision.bodyHash,
        targetIndexIdentity: indexIdentity,
      },
    });
    if (result.created) enqueued += 1;
  }
  return {
    scanned: page.length,
    enqueued,
    nextCursor: records.length > limit ? page.at(-1)!.id : null,
  };
}
