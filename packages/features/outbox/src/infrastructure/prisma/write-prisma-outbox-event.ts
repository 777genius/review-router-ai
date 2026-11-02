import type { Prisma, PrismaClient } from "@prisma/client";
import type { NewOutboxEvent } from "../../domain/outbox-event";

/** Works with both a client and an existing transaction without aborting it on replay. */
export async function writePrismaOutboxEvent(
  prisma: Pick<PrismaClient, "outboxEvent">,
  event: NewOutboxEvent,
): Promise<{ readonly created: boolean }> {
  const inserted = await prisma.outboxEvent.createMany({
    data: [
      {
        type: event.type,
        version: event.version,
        idempotencyKey: event.idempotencyKey,
        workspaceId: event.workspaceId ?? null,
        repositoryId: event.repositoryId ?? null,
        aggregateId: event.aggregateId ?? null,
        payload: JSON.parse(
          JSON.stringify(event.payload),
        ) as Prisma.InputJsonValue,
        maxAttempts: event.maxAttempts ?? 5,
        occurredAt: event.occurredAt,
      },
    ],
    skipDuplicates: true,
  });
  if (inserted.count === 1) return { created: true };
  const existing = await prisma.outboxEvent.findUnique({
    where: { idempotencyKey: event.idempotencyKey },
    select: {
      type: true,
      version: true,
      workspaceId: true,
      repositoryId: true,
      aggregateId: true,
      payload: true,
    },
  });
  if (
    !existing ||
    existing.type !== event.type ||
    existing.version !== event.version ||
    existing.workspaceId !== (event.workspaceId ?? null) ||
    existing.repositoryId !== (event.repositoryId ?? null) ||
    existing.aggregateId !== (event.aggregateId ?? null) ||
    canonicalJson(existing.payload) !== canonicalJson(event.payload)
  )
    throw new Error("outbox_idempotency_conflict");
  return { created: false };
}
function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}
function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right, "en"))
        .map(([key, child]) => [key, sortJson(child)]),
    );
  return value;
}
