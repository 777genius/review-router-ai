import {
  OutboxHandlerError,
  type OutboxEvent,
  type OutboxHandler,
} from "@reviewrouter/features-outbox";
import type { MemoryItemSnapshot } from "../../domain/memory-item";
import type { MemoryItemRepositoryPort } from "../../application/ports/memory-item-repository-port";
import type { MemorySearchWriterPort } from "../../application/ports/memory-search-index-port";

export type MemoryIndexOutboxHandlerDependencies = {
  readonly memoryItems: Pick<
    MemoryItemRepositoryPort,
    "findById" | "markIndexingDeleted" | "markIndexingSucceeded"
  >;
  readonly searchIndex: MemorySearchWriterPort;
};

const memoryLifecycleEventTypes = [
  "memory.item.created",
  "memory.item.deleted",
  "memory.item.disabled",
  "memory.item.edited",
  "memory.item.expired",
  "memory.suggestion.created",
  "memory.suggestion.confirmed",
  "memory.suggestion.rejected",
] as const;

export function createMemoryOutboxHandlers(
  dependencies: MemoryIndexOutboxHandlerDependencies,
): readonly OutboxHandler[] {
  return [
    ...memoryLifecycleEventTypes.map((type) => createNoopMemoryHandler(type)),
    createMemoryEmbeddingReindexRequestedHandler(dependencies),
    createMemoryEmbeddingDeleteRequestedHandler(dependencies),
  ];
}

export function createMemoryEmbeddingReindexRequestedHandler(
  dependencies: MemoryIndexOutboxHandlerDependencies,
): OutboxHandler {
  return {
    type: "memory.embedding.reindex.requested",
    version: 1,
    async handle(event) {
      const ids = requireMemoryEventIds(event);
      const payload = parseVersionedIndexPayload(event.payload);
      assertTargetIndex(event.payload, dependencies.searchIndex);
      await sanitizeProjectionFailure(async () => {
        const item = await dependencies.memoryItems.findById({
          workspaceId: ids.workspaceId,
          itemId: ids.memoryItemId,
        });
        if (!isActive(item)) {
          await dependencies.searchIndex.deleteDocument({
            ...ids,
            target: { kind: "item" },
          });
          await dependencies.memoryItems.markIndexingDeleted({
            workspaceId: ids.workspaceId,
            itemId: ids.memoryItemId,
          });
          return;
        }
        const revisionTarget = { kind: "revision" as const, ...payload };
        if (!matchesIndexPayload(item, payload)) {
          await dependencies.searchIndex.deleteDocument({
            ...ids,
            target: revisionTarget,
          });
          return;
        }
        const outcome = await dependencies.searchIndex.upsertDocument({
          workspaceId: item.workspaceId,
          memoryItemId: item.id,
          repositoryId: item.repositoryId,
          userId: item.userId,
          scope: item.scope,
          body: item.body,
          bodyHash: item.bodyHash,
          bodyVersion: item.bodyVersion,
          tags: item.tags,
          updatedAt: item.updatedAt,
        });
        const indexed =
          outcome.status === "indexed"
            ? await dependencies.memoryItems.markIndexingSucceeded({
                workspaceId: item.workspaceId,
                itemId: item.id,
                bodyHash: item.bodyHash,
                bodyVersion: item.bodyVersion,
              })
            : { updatedCount: 0 };
        if (indexed.updatedCount !== 1) {
          // A concurrent edit must never cause item-wide removal of its newer export.
          await dependencies.searchIndex.deleteDocument({
            ...ids,
            target: revisionTarget,
          });
        }
      });
    },
  };
}

export function createMemoryEmbeddingDeleteRequestedHandler(
  dependencies: MemoryIndexOutboxHandlerDependencies,
): OutboxHandler {
  return {
    type: "memory.embedding.delete.requested",
    version: 1,
    async handle(event) {
      const ids = requireMemoryEventIds(event);
      assertTargetIndex(event.payload, dependencies.searchIndex);
      await sanitizeProjectionFailure(async () => {
        const item = await dependencies.memoryItems.findById({
          workspaceId: ids.workspaceId,
          itemId: ids.memoryItemId,
        });
        // Persisted v1 deletion events describe a terminal item, not a revision.
        // Fail safely if an old event is ever replayed against an active item.
        if (isActive(item)) return;
        await dependencies.searchIndex.deleteDocument({
          ...ids,
          target: { kind: "item" },
        });
        await dependencies.memoryItems.markIndexingDeleted({
          workspaceId: ids.workspaceId,
          itemId: ids.memoryItemId,
        });
      });
    },
  };
}

function isActive(item: MemoryItemSnapshot | null): item is MemoryItemSnapshot {
  return (
    item !== null &&
    item.status === "active" &&
    (item.expiresAt === null || item.expiresAt.getTime() > Date.now())
  );
}

function assertTargetIndex(
  payload: unknown,
  writer: MemorySearchWriterPort,
): void {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("targetIndexIdentity" in payload)
  )
    return;
  if (payload.targetIndexIdentity !== writer.indexIdentity) {
    throw new OutboxHandlerError(
      "Memory projection event targets a different configured index",
      "memory_index_identity_conflict",
      true,
    );
  }
}

async function sanitizeProjectionFailure(
  operation: () => Promise<void>,
): Promise<void> {
  try {
    await operation();
  } catch {
    throw new OutboxHandlerError(
      "Memory projection work needs reconciliation",
      "memory_index_pending",
      true,
    );
  }
}

function createNoopMemoryHandler(type: string): OutboxHandler {
  return {
    type,
    version: 1,
    async handle(event) {
      requireMemoryEventIds(event);
    },
  };
}

function requireMemoryEventIds(event: OutboxEvent): {
  readonly workspaceId: string;
  readonly memoryItemId: string;
} {
  if (!event.workspaceId || !event.aggregateId) {
    throw new OutboxHandlerError(
      "Memory outbox event is missing workspace or aggregate id",
      "invalid_memory_outbox_event_ids",
      false,
    );
  }
  return {
    workspaceId: event.workspaceId,
    memoryItemId: event.aggregateId,
  };
}

function parseVersionedIndexPayload(payload: unknown): {
  readonly bodyHash: string;
  readonly bodyVersion: number;
} {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("bodyHash" in payload) ||
    !("bodyVersion" in payload) ||
    typeof (payload as { readonly bodyHash?: unknown }).bodyHash !== "string" ||
    typeof (payload as { readonly bodyVersion?: unknown }).bodyVersion !==
      "number" ||
    !Number.isSafeInteger((payload as { bodyVersion: number }).bodyVersion) ||
    (payload as { bodyVersion: number }).bodyVersion < 1 ||
    (payload as { bodyHash: string }).bodyHash.length === 0
  ) {
    throw new OutboxHandlerError(
      "Invalid memory index outbox payload",
      "invalid_memory_index_payload",
      false,
    );
  }
  return {
    bodyHash: (payload as { readonly bodyHash: string }).bodyHash,
    bodyVersion: (payload as { readonly bodyVersion: number }).bodyVersion,
  };
}

function matchesIndexPayload(
  item: MemoryItemSnapshot,
  payload: { readonly bodyHash: string; readonly bodyVersion: number },
): boolean {
  return (
    item.bodyHash === payload.bodyHash &&
    item.bodyVersion === payload.bodyVersion
  );
}
