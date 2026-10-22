import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  MemoryIndexDocument,
  MemorySearchIndexInput,
} from "../application/ports/memory-search-index-port";
import { createMemoryBodyHash } from "../domain/memory-body";
import { InfinityMemorySearchIndex } from "../infrastructure/infinity/infinity-memory-search-index";
import type { MemoryProjectionReceipt } from "../infrastructure/projection/memory-projection-receipt-store";
import { projectionIdentity } from "../infrastructure/infinity/projection-identity";
import { InfinityProtocolFixture } from "./infinity-protocol-fixture";
import { InfinityReceiptStoreFixture } from "./infinity-receipt-store-fixture";

describe("Infinity memory adapter with the published SDK over HTTP", () => {
  let fixture: InfinityProtocolFixture;
  let store: InfinityReceiptStoreFixture;
  let adapter: InfinityMemorySearchIndex;

  beforeEach(async () => {
    fixture = await InfinityProtocolFixture.start();
    store = new InfinityReceiptStoreFixture();
    adapter = new InfinityMemorySearchIndex({
      config: fixture.config,
      receipts: store,
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fixture?.close();
  });

  async function index(
    document = memoryDocument(),
  ): Promise<MemoryProjectionReceipt> {
    store.putCanonical(document);
    await expect(adapter.upsertDocument(document)).resolves.toEqual({
      status: "indexed",
    });
    return [...store.rows.values()].find(
      (row) =>
        row.memoryItemId === document.memoryItemId &&
        row.bodyVersion === document.bodyVersion,
    )!;
  }

  it("constructs without remote IO and sends a real scoped Contract-C projection", async () => {
    expect(fixture.requests).toEqual([]);
    const document = memoryDocument({
      bodyVersion: 7,
      tags: ["private metadata"],
    });
    const receipt = await index(document);
    const ingest = fixture.requests.find(
      (request) => request.path === "/v1/documents",
    )!;
    expect(ingest.authorization).toBe(`Bearer ${fixture.config.apiKey}`);
    expect(ingest.idempotencyKey).toBe(
      projectionIdentity(receipt).idempotencyKey,
    );
    expect(ingest.body).toEqual({
      space_id: "test-space",
      memory_scope_id: "test-scope",
      title: "Confirmed review memory",
      text: document.body,
      source_type: "reviewrouter_confirmed_memory",
      source_external_id: projectionIdentity(receipt).sourceExternalId,
      classification: "internal",
      retrieval_projection: {
        schema_version: "document-retrieval-projection.v1",
        locator: projectionIdentity(receipt).locator,
        source_key: projectionIdentity(receipt).sourceKey,
        projection_generation: fixture.config.projectionGeneration,
        sequence_ordinal: receipt.sequenceOrdinal,
        actor_keys: [],
        time_interval: null,
        relative_time_interval: null,
        kind: "confirmed_review_memory",
        category: "review_memory",
        tags: [],
      },
    });
    await expect(adapter.supports()).resolves.toEqual({
      capabilities: ["full_text", "semantic_vector", "hybrid"],
    });
    const hits = await adapter.search(searchInput());
    expect(hits).toEqual([
      {
        memoryItemId: document.memoryItemId,
        bodyVersion: 7,
        bodyHash: document.bodyHash,
        scope: "repository",
        score: expect.any(Number),
        explanationCode: "semantic_match",
      },
    ]);
    expect(hits[0]).not.toHaveProperty("scoreParts");
    expect(hits[0]).not.toHaveProperty("body");
  });

  it("keeps equal bodies for distinct canonical items as distinct documents", async () => {
    const first = await index(memoryDocument({ memoryItemId: "memory-a" }));
    const second = await index(memoryDocument({ memoryItemId: "memory-b" }));
    expect(fixture.documents.size).toBe(2);
    expect(first.remoteDocumentId).not.toBe(second.remoteDocumentId);
    expect(first.sequenceOrdinal).not.toBe(second.sequenceOrdinal);
    expect(projectionIdentity(first).sourceExternalId).not.toBe(
      projectionIdentity(second).sourceExternalId,
    );
    expect(projectionIdentity(first).sourceKey).toBe(
      projectionIdentity(second).sourceKey,
    );
    expect(
      (await adapter.search(searchInput())).map((hit) => hit.memoryItemId),
    ).toEqual(["memory-a", "memory-b"]);
  });

  it("uses only authorized collection filters and clamps result limits to the SDK bound", async () => {
    await index(memoryDocument());
    await index(
      memoryDocument({
        memoryItemId: "workspace-memory",
        scope: "workspace",
        repositoryId: null,
      }),
    );
    await index(
      memoryDocument({
        memoryItemId: "user-memory",
        scope: "user_prefs",
        repositoryId: null,
        userId: "user-1",
      }),
    );
    const input = searchInput({
      userId: "user-1",
      includeUserPrefs: true,
      allowedScopes: ["repository", "workspace", "user_prefs"],
      limit: 500,
    });
    expect((await adapter.search(input)).map((hit) => hit.scope)).toEqual([
      "repository",
      "workspace",
      "user_prefs",
    ]);
    const request = fixture.requests.find(
      (item) => item.path === "/v1/context/retrieve",
    )!;
    expect(
      (request.body.filters as Record<string, unknown>).source_generations,
    ).toHaveLength(3);
    expect(request.body.bounds).toMatchObject({
      result_limit: 50,
      neighbor_radius: 0,
    });
    expect(
      (await adapter.search({ ...input, allowedScopes: ["repository"] })).map(
        (hit) => hit.scope,
      ),
    ).toEqual(["repository"]);
  });

  it("uses byte-identical retry payloads after restart and decodes ordinary absent reconciliation", async () => {
    const document = memoryDocument();
    store.putCanonical(document);
    fixture.rejectNextIngestWith = "Temporary provider failure";
    await expect(adapter.upsertDocument(document)).rejects.toMatchObject({
      code: "memory_index_unavailable",
    });
    const before = fixture.requests.find(
      (request) => request.path === "/v1/documents",
    )!;
    adapter = new InfinityMemorySearchIndex({
      config: fixture.config,
      receipts: store,
    });
    await expect(
      adapter.upsertDocument({
        ...document,
        updatedAt: new Date("2035-01-01"),
        tags: ["later metadata"],
      }),
    ).resolves.toEqual({ status: "indexed" });
    const writes = fixture.requests.filter(
      (request) => request.path === "/v1/documents",
    );
    expect(writes).toHaveLength(2);
    expect(writes[1]!.rawBody).toBe(before.rawBody);
    expect(writes[1]!.idempotencyKey).toBe(before.idempotencyKey);
    const observations = fixture.requests.filter(
      (request) => request.path === "/v1/documents/reconcile-exact",
    );
    expect(observations.length).toBeGreaterThan(0);
    for (const observation of observations) {
      expect(observation.body).not.toHaveProperty("projection_generation");
      expect(observation.body).not.toHaveProperty("profile_generation");
    }
  });

  it("does not report accepted documents as indexed and retries reconciliation without a second write", async () => {
    const document = memoryDocument();
    store.putCanonical(document);
    fixture.autoIndex = false;
    await expect(adapter.upsertDocument(document)).rejects.toMatchObject({
      code: "memory_index_pending",
    });
    expect([...store.rows.values()][0]!.state).toBe("accepted");
    const requestsBeforeSearch = fixture.requests.length;
    await expect(adapter.search(searchInput())).rejects.toMatchObject({
      code: "memory_index_incomplete",
    });
    expect(fixture.requests).toHaveLength(requestsBeforeSearch);
    [...fixture.documents.values()][0]!.indexed = true;
    await expect(adapter.upsertDocument(document)).resolves.toEqual({
      status: "indexed",
    });
    expect(
      fixture.requests.filter((request) => request.path === "/v1/documents"),
    ).toHaveLength(1);
  });

  it("recovers a committed write with a lost acknowledgement after adapter restart", async () => {
    const document = memoryDocument();
    store.putCanonical(document);
    fixture.dropNextIngestAcknowledgement = true;
    await expect(adapter.upsertDocument(document)).rejects.toMatchObject({
      code: "memory_index_unavailable",
    });
    expect([...store.rows.values()][0]).toMatchObject({
      state: "sent_unknown",
      remoteDocumentId: null,
    });
    adapter = new InfinityMemorySearchIndex({
      config: fixture.config,
      receipts: store,
    });
    await expect(adapter.upsertDocument(document)).resolves.toEqual({
      status: "indexed",
    });
    expect(
      fixture.requests.filter((request) => request.path === "/v1/documents"),
    ).toHaveLength(1);
    expect([...store.rows.values()][0]!.remoteDocumentId).toBe("doc_1");
  });

  it("cancels a never-sent reservation before a delayed sender can dispatch", async () => {
    const document = memoryDocument();
    store.putCanonical(document);
    store.beforeAdmission = async () => {
      store.canonical.delete(document.memoryItemId);
      await store.requestDeletion({
        indexIdentity: fixture.config.indexIdentity,
        workspaceId: document.workspaceId,
        memoryItemId: document.memoryItemId,
        target: { kind: "item" },
      });
    };
    await expect(adapter.upsertDocument(document)).resolves.toEqual({
      status: "superseded",
    });
    expect(
      fixture.requests.filter((request) => request.path === "/v1/documents"),
    ).toEqual([]);
    expect([...store.rows.values()][0]!.state).toBe("deleted");
  });

  it("cleans a stale late acknowledgement without touching the newer canonical revision", async () => {
    const original = memoryDocument();
    const updated = memoryDocument({
      bodyVersion: 2,
      body: "Use deterministic checks and verify provenance.",
    });
    store.putCanonical(original);
    fixture.afterIngest = async () => {
      store.putCanonical(updated);
    };
    await expect(adapter.upsertDocument(original)).resolves.toEqual({
      status: "superseded",
    });
    expect([...fixture.documents.values()][0]!.status).toBe("deleted");
    expect(store.canonical.get(original.memoryItemId)).toEqual(updated);
    fixture.afterIngest = undefined;
    await expect(adapter.upsertDocument(updated)).resolves.toEqual({
      status: "indexed",
    });
    expect(
      [...fixture.documents.values()].map((document) => document.status),
    ).toEqual(["deleted", "active"]);
  });

  it("preserves concurrent delete intent when the native ID arrives late", async () => {
    const document = memoryDocument();
    store.putCanonical(document);
    fixture.afterIngest = async () => {
      store.canonical.delete(document.memoryItemId);
      await store.requestDeletion({
        indexIdentity: fixture.config.indexIdentity,
        workspaceId: document.workspaceId,
        memoryItemId: document.memoryItemId,
        target: { kind: "item" },
      });
    };
    await expect(adapter.upsertDocument(document)).resolves.toEqual({
      status: "superseded",
    });
    expect([...store.rows.values()][0]).toMatchObject({
      state: "deleted",
      deleteRequested: true,
      remoteDocumentId: "doc_1",
    });
    expect([...fixture.documents.values()][0]!.status).toBe("deleted");
  });

  it("retains unknown-write debt across ordinary absence and later deletes a delayed commit", async () => {
    const document = memoryDocument();
    store.putCanonical(document);
    fixture.rejectNextIngestWith = "Request result uncertain";
    await expect(adapter.upsertDocument(document)).rejects.toBeDefined();
    const pending = fixture.requests.find(
      (request) => request.path === "/v1/documents",
    )!;
    store.canonical.delete(document.memoryItemId);
    await expect(
      adapter.deleteDocument({
        workspaceId: document.workspaceId,
        memoryItemId: document.memoryItemId,
        target: { kind: "item" },
      }),
    ).rejects.toMatchObject({ code: "memory_index_pending" });
    expect([...store.rows.values()][0]).toMatchObject({
      state: "sent_unknown",
      deleteRequested: true,
      remoteDocumentId: null,
    });
    expect(
      fixture.requests.filter((request) => request.method === "DELETE"),
    ).toEqual([]);
    fixture.commitIngest(pending);
    store.makeAllDue();
    adapter = new InfinityMemorySearchIndex({
      config: fixture.config,
      receipts: store,
    });
    await expect(adapter.reconcilePending()).resolves.toMatchObject({
      processed: 1,
      deleted: 1,
      pending: 0,
    });
    expect([...store.rows.values()][0]!.state).toBe("deleted");
    expect([...fixture.documents.values()][0]!.status).toBe("deleted");
  });

  it("deletes exact old receipts while preserving a newer projection", async () => {
    const previous = memoryDocument();
    await index(previous);
    const current = memoryDocument({
      bodyVersion: 2,
      body: "Use deterministic checks with canonical authorization.",
    });
    await index(current);
    await adapter.deleteDocument({
      workspaceId: previous.workspaceId,
      memoryItemId: previous.memoryItemId,
      target: {
        kind: "revision",
        bodyVersion: previous.bodyVersion,
        bodyHash: previous.bodyHash,
      },
    });
    expect(
      [...fixture.documents.values()].map((document) => document.status),
    ).toEqual(["deleted", "active"]);
    expect((await adapter.search(searchInput()))[0]!.bodyVersion).toBe(2);
  });

  it("deletes every inventoried revision for terminal item deletion", async () => {
    const document = memoryDocument();
    await index(document);
    await index(
      memoryDocument({
        bodyVersion: 2,
        body: "Use deterministic checks with bounded deadlines.",
      }),
    );
    store.canonical.delete(document.memoryItemId);
    await adapter.deleteDocument({
      workspaceId: document.workspaceId,
      memoryItemId: document.memoryItemId,
      target: { kind: "item" },
    });
    expect(
      [...fixture.documents.values()].every(
        (value) => value.status === "deleted",
      ),
    ).toBe(true);
    expect(
      [...store.rows.values()].every((value) => value.state === "deleted"),
    ).toBe(true);
    expect(store.retired.has(fixture.config.indexIdentity)).toBe(false);
  });

  it("reconciles orphan metadata without a canonical row or original outbox event", async () => {
    const document = memoryDocument();
    await index(document);
    store.canonical.clear();
    await expect(adapter.reconcilePending()).resolves.toEqual({
      processed: 1,
      deleted: 1,
      pending: 0,
    });
    expect([...fixture.documents.values()][0]!.status).toBe("deleted");
  });

  it("reconciles a lost delete acknowledgement without forgetting the known document", async () => {
    const document = memoryDocument();
    await index(document);
    store.canonical.delete(document.memoryItemId);
    fixture.dropNextDeleteAcknowledgement = true;
    const target = {
      workspaceId: document.workspaceId,
      memoryItemId: document.memoryItemId,
      target: { kind: "item" as const },
    };
    await expect(adapter.deleteDocument(target)).rejects.toMatchObject({
      code: "memory_index_pending",
    });
    expect([...store.rows.values()][0]).toMatchObject({
      deleteRequested: true,
      remoteDocumentId: "doc_1",
    });
    expect([...store.rows.values()][0]!.state).not.toBe("deleted");
    adapter = new InfinityMemorySearchIndex({
      config: fixture.config,
      receipts: store,
    });
    await expect(adapter.deleteDocument(target)).resolves.toBeUndefined();
    expect([...store.rows.values()][0]!.state).toBe("deleted");
    expect(
      fixture.requests.filter((request) => request.method === "DELETE"),
    ).toHaveLength(1);
  });

  it("defers permanent unknown debt so later due orphan cleanup can progress", async () => {
    const uncertain = memoryDocument({ memoryItemId: "uncertain" });
    store.putCanonical(uncertain);
    fixture.rejectNextIngestWith = "Unknown write";
    await expect(adapter.upsertDocument(uncertain)).rejects.toBeDefined();
    await index(memoryDocument({ memoryItemId: "known" }));
    store.canonical.clear();
    store.makeAllDue();
    await expect(adapter.reconcilePending({ limit: 1 })).resolves.toMatchObject(
      { pending: 1 },
    );
    await expect(adapter.reconcilePending({ limit: 1 })).resolves.toEqual({
      processed: 1,
      deleted: 1,
      pending: 0,
    });
    expect(
      [...store.rows.values()].find((row) => row.memoryItemId === "uncertain")!
        .state,
    ).toBe("sent_unknown");
    expect(
      [...store.rows.values()].find((row) => row.memoryItemId === "known")!
        .state,
    ).toBe("deleted");
  });

  it("stops an exhausted maintenance pass without deferring untouched receipts", async () => {
    const receipts: MemoryProjectionReceipt[] = [];
    for (const memoryItemId of ["slow", "later-a", "later-b"]) {
      const receipt = await index(memoryDocument({ memoryItemId }));
      store.rows.set(receipt.id, { ...receipt, state: "accepted" });
      receipts.push(receipt);
    }
    store.makeAllDue();
    const untouched = receipts.slice(1).map((receipt) => ({
      row: store.rows.get(receipt.id),
      dueAt: store.dueAt.get(receipt.id),
    }));
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const before = fixture.requests.length;
    fixture.reconciliationTransform = (response) => {
      // One real SDK request consumed nearly the whole pass and failed validation.
      now += 4_951;
      return { ...response, projection_generation: "unexpected-generation" };
    };

    await expect(adapter.reconcilePending({ limit: 100 })).resolves.toEqual({
      processed: 1,
      deleted: 0,
      pending: 3,
    });
    expect(store.deferred).toEqual([
      { receiptId: receipts[0]!.id, reasonCode: "memory_index_conflict" },
    ]);
    expect(
      receipts.slice(1).map((receipt) => ({
        row: store.rows.get(receipt.id),
        dueAt: store.dueAt.get(receipt.id),
      })),
    ).toEqual(untouched);
    expect(
      fixture.requests.slice(before).map((request) => request.path),
    ).toEqual(["/v1/capabilities", "/v1/documents/reconcile-exact"]);

    fixture.reconciliationTransform = undefined;
    await expect(adapter.reconcilePending({ limit: 100 })).resolves.toEqual({
      processed: 2,
      deleted: 0,
      pending: 0,
    });
    expect(
      receipts.slice(1).map((receipt) => store.rows.get(receipt.id)!.state),
    ).toEqual(["indexed", "indexed"]);
    expect(store.deferred).toHaveLength(1);
    expect(
      fixture.requests
        .slice(before)
        .filter((request) => request.path === "/v1/capabilities"),
    ).toHaveLength(2);
  });

  it("bounds item deletion while leaving skipped revisions ready for the next pass", async () => {
    const receipts: MemoryProjectionReceipt[] = [];
    for (const bodyVersion of [1, 2, 3]) {
      receipts.push(
        await index(
          memoryDocument({
            bodyVersion,
            body: `Confirmed review memory revision ${bodyVersion}.`,
          }),
        ),
      );
    }
    store.canonical.clear();
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const markDeleted = store.markDeleted.bind(store);
    vi.spyOn(store, "markDeleted").mockImplementation(async (input) => {
      await markDeleted(input);
      if (input.receiptId === receipts[0]!.id) now += 4_951;
    });
    const before = fixture.requests.length;
    const target = {
      workspaceId: receipts[0]!.workspaceId,
      memoryItemId: receipts[0]!.memoryItemId,
      target: { kind: "item" as const },
    };

    await expect(adapter.deleteDocument(target)).rejects.toMatchObject({
      code: "memory_index_pending",
    });
    expect(
      receipts.map((receipt) => store.rows.get(receipt.id)!.state),
    ).toEqual(["deleted", "indexed", "indexed"]);
    expect(store.deferred).toEqual([]);
    expect(
      (
        await store.listDue({
          indexIdentity: fixture.config.indexIdentity,
          limit: 10,
          now: new Date(),
        })
      ).map((receipt) => receipt.id),
    ).toEqual(receipts.slice(1).map((receipt) => receipt.id));
    expect(
      fixture.requests.slice(before).map((request) => request.path),
    ).toEqual([
      "/v1/capabilities",
      "/v1/documents/reconcile-exact",
      "/v1/documents/doc_1",
    ]);

    await expect(adapter.deleteDocument(target)).resolves.toBeUndefined();
    expect(
      receipts.map((receipt) => store.rows.get(receipt.id)!.state),
    ).toEqual(["deleted", "deleted", "deleted"]);
    expect(store.deferred).toEqual([]);
    expect(
      fixture.requests
        .slice(before)
        .filter((request) => request.path === "/v1/capabilities"),
    ).toHaveLength(2);
  });

  it("reports skipped drain debt and retires only after a later complete pass", async () => {
    const receipts: MemoryProjectionReceipt[] = [];
    for (const memoryItemId of ["drain-a", "drain-b", "drain-c"]) {
      receipts.push(await index(memoryDocument({ memoryItemId })));
    }
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const markDeleted = store.markDeleted.bind(store);
    vi.spyOn(store, "markDeleted").mockImplementation(async (input) => {
      await markDeleted(input);
      if (input.receiptId === receipts[0]!.id) now += 4_951;
    });
    const before = fixture.requests.length;

    await expect(adapter.drain({ limit: 100 })).resolves.toEqual({
      processed: 1,
      deleted: 1,
      pending: 2,
    });
    expect(store.retired.size).toBe(0);
    expect(store.deferred).toEqual([]);
    expect(
      receipts.slice(1).map((receipt) => store.rows.get(receipt.id)),
    ).toEqual(receipts.slice(1));

    await expect(adapter.drain({ limit: 100 })).resolves.toEqual({
      processed: 2,
      deleted: 2,
      pending: 0,
    });
    expect(store.retired.has(fixture.config.indexIdentity)).toBe(true);
    expect(store.deferred).toEqual([]);
    expect(
      fixture.requests
        .slice(before)
        .filter((request) => request.path === "/v1/capabilities"),
    ).toHaveLength(2);
  });

  it("does not retire a generation while unknown debt remains", async () => {
    const document = memoryDocument();
    store.putCanonical(document);
    fixture.rejectNextIngestWith = "Unknown result";
    await expect(adapter.upsertDocument(document)).rejects.toBeDefined();
    await expect(adapter.drain()).resolves.toMatchObject({ pending: 1 });
    expect(store.retired.size).toBe(0);
  });

  it("retires a successfully drained generation and requires a fresh identity", async () => {
    await index();
    await expect(adapter.drain()).resolves.toEqual({
      processed: 1,
      deleted: 1,
      pending: 0,
    });
    expect(store.retired.has(fixture.config.indexIdentity)).toBe(true);
    await expect(
      adapter.upsertDocument(memoryDocument()),
    ).rejects.toMatchObject({ code: "memory_index_unavailable" });
  });

  it("keeps healthy no-match separate from provider unavailability", async () => {
    await index();
    await expect(
      adapter.search(searchInput({ safeQuery: "no-match-in-this-fixture" })),
    ).resolves.toEqual([]);
    fixture.retrievalTransform = (response) => ({
      ...response,
      status: "unavailable",
      candidates: [],
      applied_bounds: {
        ...(response.applied_bounds as Record<string, unknown>),
        returned_seeds: 0,
      },
      provider_outcomes: [
        {
          provider_id: "postgres_keyword",
          status: "available",
          reason_code: null,
        },
        {
          provider_id: "qdrant_dense",
          status: "unavailable",
          reason_code: "provider_error",
        },
      ],
    });
    await expect(adapter.search(searchInput())).rejects.toMatchObject({
      code: "memory_index_unavailable",
    });
  });

  it("uses canonical fallback when only part of the current authorized inventory is indexed", async () => {
    await index();
    store.putCanonical(memoryDocument({ memoryItemId: "not-backfilled" }));
    const requestCount = fixture.requests.length;
    await expect(adapter.search(searchInput())).rejects.toMatchObject({
      code: "memory_index_incomplete",
    });
    expect(fixture.requests).toHaveLength(requestCount);
  });

  it.each(["native-id", "foreign-locator", "foreign-scope"] as const)(
    "rejects a candidate with %s instead of trusting its locator text",
    async (kind) => {
      await index();
      const foreign = await index(
        memoryDocument({
          memoryItemId: "foreign",
          workspaceId: "other-workspace",
          repositoryId: "other-repository",
        }),
      );
      fixture.retrievalTransform = (response) => {
        const candidates = response.candidates as Record<string, unknown>[];
        const candidate = candidates[0]!;
        if (kind === "native-id") candidate.document_key = "doc_not_receipted";
        if (kind === "foreign-locator")
          candidate.locator = "rrmem:v1:foreign:receipt_1";
        if (kind === "foreign-scope") {
          candidate.locator = projectionIdentity(foreign).locator;
          candidate.source_key = projectionIdentity(foreign).sourceKey;
          candidate.document_key = foreign.remoteDocumentId;
        }
        return response;
      };
      await expect(adapter.search(searchInput())).rejects.toMatchObject({
        code: "memory_index_stale",
      });
    },
  );

  it("rejects a canonical revision changed after readiness was checked", async () => {
    await index();
    store.coverageOverride = true;
    store.putCanonical(
      memoryDocument({
        bodyVersion: 2,
        body: "Use deterministic checks for the new revision.",
      }),
    );
    await expect(adapter.search(searchInput())).rejects.toMatchObject({
      code: "memory_index_stale",
    });
  });

  it("verifies projection generation on found exact reconciliations", async () => {
    const document = memoryDocument();
    store.putCanonical(document);
    fixture.reconciliationTransform = (response) => ({
      ...response,
      projection_generation: "foreign-generation",
    });
    await expect(adapter.upsertDocument(document)).rejects.toMatchObject({
      code: "memory_index_conflict",
    });
    expect([...store.rows.values()][0]!.state).toBe("accepted");
  });

  it("rejects path-like native IDs discovered during reconciliation", async () => {
    const document = memoryDocument();
    store.putCanonical(document);
    fixture.dropNextIngestAcknowledgement = true;
    await expect(adapter.upsertDocument(document)).rejects.toBeDefined();
    store.canonical.delete(document.memoryItemId);
    fixture.reconciliationTransform = (response) => ({
      ...response,
      document_id: "../spaces/test-space",
    });
    await expect(
      adapter.deleteDocument({
        workspaceId: document.workspaceId,
        memoryItemId: document.memoryItemId,
        target: { kind: "item" },
      }),
    ).rejects.toMatchObject({ code: "memory_index_pending" });
    expect(
      fixture.requests.filter((request) => request.method === "DELETE"),
    ).toEqual([]);
    expect([...store.rows.values()][0]!.remoteDocumentId).toBeNull();
  });

  it("fails closed on missing capabilities and mismatched capability pins", async () => {
    fixture.omitRetrievalCapability = true;
    await expect(adapter.supports()).rejects.toMatchObject({
      code: "memory_index_unavailable",
    });
    fixture.omitRetrievalCapability = false;
    const wrongPin = new InfinityMemorySearchIndex({
      config: { ...fixture.config, capabilityFingerprint: "0".repeat(64) },
      receipts: store,
    });
    await expect(wrongPin.supports()).rejects.toMatchObject({
      code: "memory_index_unavailable",
    });
  });

  it("rejects partial required-provider results and oversized response bodies", async () => {
    await index();
    fixture.retrievalTransform = (response) => ({
      ...response,
      provider_outcomes: [
        {
          provider_id: "postgres_keyword",
          status: "available",
          reason_code: null,
        },
        {
          provider_id: "qdrant_dense",
          status: "unavailable",
          reason_code: "provider_error",
        },
      ],
    });
    await expect(adapter.search(searchInput())).rejects.toMatchObject({
      code: "memory_index_unavailable",
    });
    fixture.retrievalTransform = (response) => ({
      ...response,
      provider_text: "x".repeat(300_000),
    });
    await expect(adapter.search(searchInput())).rejects.toMatchObject({
      code: "memory_index_unavailable",
    });
  });

  it("honors cancellation before IO and one shared capability/retrieval deadline", async () => {
    await index();
    const controller = new AbortController();
    controller.abort();
    const before = fixture.requests.length;
    await expect(
      adapter.search(searchInput(), {
        deadlineAtMs: Date.now() + 1_000,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "memory_index_deadline" });
    expect(fixture.requests).toHaveLength(before);
    fixture.capabilitiesDelayMs = 70;
    const controls = { deadlineAtMs: Date.now() + 120 };
    await adapter.supports(controls);
    await expect(adapter.search(searchInput(), controls)).rejects.toBeDefined();
    expect(
      fixture.requests.filter(
        (request) => request.path === "/v1/context/retrieve",
      ),
    ).toHaveLength(0);
  });

  it("removes provider body, query and credential sentinels from public errors and receipt metadata", async () => {
    const document = memoryDocument();
    store.putCanonical(document);
    const querySentinel = "PRIVATE_QUERY_31f301";
    const sentinel = `${document.body} ${querySentinel} ${fixture.config.apiKey}`;
    fixture.rejectNextIngestWith = sentinel;
    const error = await adapter
      .upsertDocument(document)
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      name: "MemoryIndexOperationError",
      code: "memory_index_unavailable",
      message: "memory_index_unavailable",
    });
    expect(error).not.toHaveProperty("cause");
    const diagnostics = JSON.stringify({
      error,
      rows: [...store.rows.values()],
      deferred: store.deferred,
    });
    for (const value of [document.body, querySentinel, fixture.config.apiKey]) {
      expect(diagnostics).not.toContain(value);
    }
  });

  it("rejects invalid canonical bodies before reserving or sending them", async () => {
    const document = memoryDocument({ body: "A".repeat(1_001) });
    store.putCanonical(document);
    await expect(adapter.upsertDocument(document)).rejects.toMatchObject({
      code: "memory_index_document_invalid",
    });
    expect(store.rows.size).toBe(0);
    expect(fixture.requests).toEqual([]);
  });
});

function memoryDocument(
  input: Partial<MemoryIndexDocument> = {},
): MemoryIndexDocument {
  const body = input.body ?? "Use deterministic checks for repository reviews.";
  return {
    workspaceId: "workspace-1",
    memoryItemId: "memory-1",
    repositoryId: "repository-1",
    userId: null,
    scope: "repository",
    body,
    bodyHash: createMemoryBodyHash(body),
    bodyVersion: 1,
    tags: [],
    updatedAt: new Date("2026-10-22T12:00:00.000Z"),
    ...input,
  };
}

function searchInput(
  input: Partial<MemorySearchIndexInput> = {},
): MemorySearchIndexInput {
  return {
    workspaceId: "workspace-1",
    repositoryId: "repository-1",
    userId: null,
    safeQuery: "deterministic",
    limit: 12,
    includeUserPrefs: false,
    allowedScopes: ["repository"],
    ...input,
  };
}
