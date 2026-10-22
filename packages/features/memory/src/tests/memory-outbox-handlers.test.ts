import { describe, expect, it, vi } from "vitest";
import type { MemoryItemSnapshot } from "../domain/memory-item";
import { MemoryItem } from "../domain/memory-item";
import { createDashboardMemorySource } from "../domain/memory-source";
import type { MemorySearchIndexPort } from "../application/ports/memory-search-index-port";
import {
  createMemoryEmbeddingDeleteRequestedHandler,
  createMemoryEmbeddingReindexRequestedHandler,
  createMemoryOutboxHandlers,
} from "../infrastructure/outbox/memory-index-outbox-handlers";
import type { OutboxEvent } from "@reviewrouter/features-outbox";

const now = new Date("2026-05-12T12:00:00.000Z");

class StaticMemoryItems {
  readonly indexingSucceeded: unknown[] = [];
  readonly indexingDeleted: unknown[] = [];

  constructor(
    private readonly items: ReadonlyMap<string, MemoryItemSnapshot>,
  ) {}

  async findById(input: {
    readonly workspaceId: string;
    readonly itemId: string;
  }): Promise<MemoryItemSnapshot | null> {
    const item = this.items.get(input.itemId);
    return item?.workspaceId === input.workspaceId ? item : null;
  }

  async markIndexingSucceeded(input: {
    readonly workspaceId: string;
    readonly itemId: string;
    readonly bodyHash: string;
    readonly bodyVersion: number;
  }): Promise<{ readonly updatedCount: number }> {
    this.indexingSucceeded.push(input);
    return { updatedCount: 1 };
  }

  async markIndexingDeleted(input: {
    readonly workspaceId: string;
    readonly itemId: string;
  }): Promise<{ readonly updatedCount: number }> {
    this.indexingDeleted.push(input);
    return { updatedCount: 1 };
  }
}

class CapturingSearchIndex implements MemorySearchIndexPort {
  readonly indexIdentity = "prisma";
  readonly upserts: unknown[] = [];
  readonly deletes: unknown[] = [];

  async supports(): ReturnType<MemorySearchIndexPort["supports"]> {
    return { capabilities: ["lexical"] };
  }

  async search(): ReturnType<MemorySearchIndexPort["search"]> {
    return [];
  }

  async upsertDocument(
    input: Parameters<MemorySearchIndexPort["upsertDocument"]>[0],
  ): ReturnType<MemorySearchIndexPort["upsertDocument"]> {
    this.upserts.push(input);
    return { status: "indexed" };
  }

  async deleteDocument(
    input: Parameters<MemorySearchIndexPort["deleteDocument"]>[0],
  ): ReturnType<MemorySearchIndexPort["deleteDocument"]> {
    this.deletes.push(input);
  }
}

describe("memory outbox handlers", () => {
  it("reindexes from canonical active memory instead of outbox payload body", async () => {
    const item = memoryItem("mem_1", "Prefer ports and adapters.");
    const searchIndex = new CapturingSearchIndex();
    const memoryItems = new StaticMemoryItems(new Map([[item.id, item]]));
    const handler = createMemoryEmbeddingReindexRequestedHandler({
      memoryItems,
      searchIndex,
    });

    await handler.handle(
      outboxEvent({
        type: "memory.embedding.reindex.requested",
        aggregateId: item.id,
        payload: {
          bodyHash: item.bodyHash,
          bodyVersion: item.bodyVersion,
        },
      }),
    );

    expect(searchIndex.upserts).toEqual([
      expect.objectContaining({
        workspaceId: "workspace_1",
        memoryItemId: item.id,
        body: "Prefer ports and adapters.",
        bodyHash: item.bodyHash,
      }),
    ]);
    expect(searchIndex.deletes).toEqual([]);
    expect(memoryItems.indexingSucceeded).toEqual([
      {
        workspaceId: "workspace_1",
        itemId: item.id,
        bodyHash: item.bodyHash,
        bodyVersion: item.bodyVersion,
      },
    ]);
    expect(memoryItems.indexingDeleted).toEqual([]);
  });

  it("drops stale or inactive index documents without leaking memory body", async () => {
    const item = MemoryItem.fromSnapshot(
      memoryItem("mem_1", "Disabled body must be removed."),
    )
      .disable({
        actor: {
          kind: "github_user",
          id: "user_1",
          githubUserId: "1",
          login: "maintainer",
        },
        now,
      })
      .snapshot();
    const searchIndex = new CapturingSearchIndex();
    const memoryItems = new StaticMemoryItems(new Map([[item.id, item]]));
    const handler = createMemoryEmbeddingReindexRequestedHandler({
      memoryItems,
      searchIndex,
    });

    await handler.handle(
      outboxEvent({
        type: "memory.embedding.reindex.requested",
        aggregateId: item.id,
        payload: {
          bodyHash: item.bodyHash,
          bodyVersion: item.bodyVersion,
        },
      }),
    );

    expect(searchIndex.upserts).toEqual([]);
    expect(searchIndex.deletes).toEqual([
      {
        workspaceId: "workspace_1",
        memoryItemId: item.id,
        target: { kind: "item" },
      },
    ]);
    expect(memoryItems.indexingSucceeded).toEqual([]);
    expect(memoryItems.indexingDeleted).toEqual([
      { workspaceId: "workspace_1", itemId: item.id },
    ]);
  });

  it("cleans only stale revisions and refuses terminal cleanup of an active item", async () => {
    const item = memoryItem("mem_1", "Fresh body wins over stale event.");
    const searchIndex = new CapturingSearchIndex();
    const memoryItems = new StaticMemoryItems(new Map([[item.id, item]]));
    const dependencies = {
      memoryItems,
      searchIndex,
    };

    await createMemoryEmbeddingReindexRequestedHandler(dependencies).handle(
      outboxEvent({
        type: "memory.embedding.reindex.requested",
        aggregateId: item.id,
        payload: {
          bodyHash: "stale_hash",
          bodyVersion: item.bodyVersion,
        },
      }),
    );
    await createMemoryEmbeddingDeleteRequestedHandler(dependencies).handle(
      outboxEvent({
        type: "memory.embedding.delete.requested",
        aggregateId: item.id,
        payload: { scope: "repository" },
      }),
    );

    expect(searchIndex.upserts).toEqual([]);
    expect(searchIndex.deletes).toEqual([
      {
        workspaceId: "workspace_1",
        memoryItemId: item.id,
        target: {
          kind: "revision",
          bodyHash: "stale_hash",
          bodyVersion: item.bodyVersion,
        },
      },
    ]);
    expect(memoryItems.indexingSucceeded).toEqual([]);
    expect(memoryItems.indexingDeleted).toEqual([]);
  });

  it("cleans only the exported revision when canonical CAS loses an edit race", async () => {
    const item = memoryItem(
      "mem_race",
      "Canonical content can change during indexing.",
    );
    const searchIndex = new CapturingSearchIndex();
    const memoryItems = new StaticMemoryItems(new Map([[item.id, item]]));
    vi.spyOn(memoryItems, "markIndexingSucceeded").mockResolvedValue({
      updatedCount: 0,
    });
    await createMemoryEmbeddingReindexRequestedHandler({
      memoryItems,
      searchIndex,
    }).handle(
      outboxEvent({
        type: "memory.embedding.reindex.requested",
        aggregateId: item.id,
        payload: { bodyHash: item.bodyHash, bodyVersion: item.bodyVersion },
      }),
    );
    expect(searchIndex.deletes).toEqual([
      {
        workspaceId: item.workspaceId,
        memoryItemId: item.id,
        target: {
          kind: "revision",
          bodyHash: item.bodyHash,
          bodyVersion: item.bodyVersion,
        },
      },
    ]);
  });

  it("does not mark an explicitly superseded write indexed", async () => {
    const item = memoryItem(
      "mem_superseded",
      "An obsolete revision cannot be acknowledged.",
    );
    const searchIndex = new CapturingSearchIndex();
    const memoryItems = new StaticMemoryItems(new Map([[item.id, item]]));
    vi.spyOn(searchIndex, "upsertDocument").mockResolvedValue({
      status: "superseded",
    });
    await createMemoryEmbeddingReindexRequestedHandler({
      memoryItems,
      searchIndex,
    }).handle(
      outboxEvent({
        type: "memory.embedding.reindex.requested",
        aggregateId: item.id,
        payload: { bodyHash: item.bodyHash, bodyVersion: item.bodyVersion },
      }),
    );
    expect(memoryItems.indexingSucceeded).toEqual([]);
    expect(searchIndex.deletes[0]).toMatchObject({
      target: { kind: "revision" },
    });
  });

  it("rejects a backfill event targeted at another index before any IO", async () => {
    const searchIndex = new CapturingSearchIndex();
    const memoryItems = new StaticMemoryItems(new Map());
    const find = vi.spyOn(memoryItems, "findById");
    await expect(
      createMemoryEmbeddingReindexRequestedHandler({
        memoryItems,
        searchIndex,
      }).handle(
        outboxEvent({
          type: "memory.embedding.reindex.requested",
          aggregateId: "mem_1",
          payload: {
            bodyHash: "hash",
            bodyVersion: 1,
            targetIndexIdentity: "infinity:another",
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: "memory_index_identity_conflict",
      retryable: true,
    });
    expect(find).not.toHaveBeenCalled();
    expect(searchIndex.upserts).toEqual([]);
  });

  it("never stores provider body/query/token errors in outbox failure metadata", async () => {
    const item = memoryItem("mem_privacy", "Private confirmed body sentinel.");
    const searchIndex = new CapturingSearchIndex();
    const memoryItems = new StaticMemoryItems(new Map([[item.id, item]]));
    vi.spyOn(searchIndex, "upsertDocument").mockRejectedValue(
      new Error("BODY_SENTINEL QUERY_SENTINEL TOKEN_SENTINEL"),
    );
    const failure = await createMemoryEmbeddingReindexRequestedHandler({
      memoryItems,
      searchIndex,
    })
      .handle(
        outboxEvent({
          type: "memory.embedding.reindex.requested",
          aggregateId: item.id,
          payload: { bodyHash: item.bodyHash, bodyVersion: item.bodyVersion },
        }),
      )
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({
      code: "memory_index_pending",
      retryable: true,
    });
    expect(String(failure)).not.toMatch(/SENTINEL/);
    expect(JSON.stringify(failure)).not.toMatch(/SENTINEL/);
    expect(memoryItems.indexingSucceeded).toEqual([]);
  });

  it("registers handlers for lifecycle events so worker does not dead-letter them", () => {
    expect(
      createMemoryOutboxHandlers({
        memoryItems: new StaticMemoryItems(new Map()),
        searchIndex: new CapturingSearchIndex(),
      }).map((handler) => `${handler.type}@${handler.version}`),
    ).toEqual([
      "memory.item.created@1",
      "memory.item.deleted@1",
      "memory.item.disabled@1",
      "memory.item.edited@1",
      "memory.item.expired@1",
      "memory.suggestion.created@1",
      "memory.suggestion.confirmed@1",
      "memory.suggestion.rejected@1",
      "memory.embedding.reindex.requested@1",
      "memory.embedding.delete.requested@1",
    ]);
  });
});

function memoryItem(id: string, body: string): MemoryItemSnapshot {
  return MemoryItem.create({
    id,
    workspaceId: "workspace_1",
    repositoryId: "repo_1",
    userId: null,
    scope: "repository",
    body,
    riskLevel: "low",
    confidence: 1,
    source: createDashboardMemorySource({ actorLogin: "maintainer" }),
    policyVersion: 1,
    safetyPolicyVersion: 1,
    actor: {
      kind: "github_user",
      id: "user_1",
      githubUserId: "1",
      login: "maintainer",
    },
    now,
  }).snapshot();
}

function outboxEvent(input: {
  readonly type: string;
  readonly aggregateId: string | null;
  readonly payload: unknown;
}): OutboxEvent {
  return {
    id: `${input.type}:${input.aggregateId ?? "missing"}`,
    type: input.type,
    version: 1,
    idempotencyKey: `${input.type}:${input.aggregateId ?? "missing"}`,
    workspaceId: "workspace_1",
    repositoryId: "repo_1",
    aggregateId: input.aggregateId,
    payload: input.payload,
    status: "processing",
    attempts: 1,
    maxAttempts: 5,
    nextAttemptAt: null,
    claimId: "claim_1",
    claimVersion: 1n,
    claimOwnerHash: "worker_1",
    claimUntil: new Date(now.getTime() + 60_000),
    occurredAt: now,
  };
}
