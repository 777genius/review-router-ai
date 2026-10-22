import {
  assertExactDocumentReconciliationCapabilityV1,
  assertRetrievalCapability,
  InfinityContextClient,
  verifyRetrievalCapabilityFingerprint,
  type ExactDocumentReconciliationCapabilityV1,
  type ExactDocumentReconciliationResultV1,
  type InfinityContextCapabilities,
  type RetrievalCapability,
  type RetrieveContextInput,
} from "@infinity-context/sdk";
import {
  MemoryIndexOperationError,
  safeMemoryIndexErrorCode,
  type MemoryIndexDeleteInput,
  type MemoryIndexDocument,
  type MemoryIndexWriteResult,
  type MemorySearchIndexCapabilities,
  type MemorySearchIndexInput,
  type MemorySearchIndexPort,
  type MemorySearchIndexResult,
  type MemorySearchRequestControls,
} from "../../application/ports/memory-search-index-port";
import {
  createMemoryBodyHash,
  memoryBodyMaxCharacters,
  normalizeMemoryBody,
} from "../../domain/memory-body";
import type { InfinityMemorySearchConfig } from "../config/memory-search-config";
import type {
  MemoryProjectionReceipt,
  MemoryProjectionReceiptStore,
  MemoryProjectionRevision,
} from "../projection/memory-projection-receipt-store";
import {
  authorizedSourceKeys,
  projectionIdentity,
  receiptIdFromLocator,
  receiptIsAuthorized,
} from "./projection-identity";

const sourceType = "reviewrouter_confirmed_memory";
const projectionTitle = "Confirmed review memory";
const defaultReadBudgetMs = 2_000;
const defaultWriteBudgetMs = 5_000;
const minimumReconciliationBudgetMs = 50;
const cleanupBatchLimit = 10;
const retryDelayMs = 60_000;
const responseByteLimit = 262_144;

export type MemoryProjectionMaintenanceResult = {
  readonly processed: number;
  readonly deleted: number;
  /** Bounded pending work observed in this pass, not a global inventory count. */
  readonly pending: number;
};

/** All Infinity protocol types and responses terminate at this adapter. */
export class InfinityMemorySearchIndex implements MemorySearchIndexPort {
  readonly indexIdentity: string;
  private readonly config: InfinityMemorySearchConfig;
  private readonly receipts: MemoryProjectionReceiptStore;
  private readonly client: InfinityContextClient;
  private readonly writeBudgetMs: number;

  constructor(input: {
    readonly config: InfinityMemorySearchConfig;
    readonly receipts: MemoryProjectionReceiptStore;
    /** Narrow budget seam for protocol timeout qualification. */
    readonly writeTimeoutMs?: number;
  }) {
    this.config = input.config;
    this.indexIdentity = input.config.indexIdentity;
    this.receipts = input.receipts;
    this.writeBudgetMs = input.writeTimeoutMs ?? defaultWriteBudgetMs;
    if (
      !Number.isSafeInteger(this.writeBudgetMs) ||
      this.writeBudgetMs < minimumReconciliationBudgetMs ||
      this.writeBudgetMs > 30_000
    ) {
      throw new MemoryIndexOperationError("memory_index_deadline");
    }
    this.client = new InfinityContextClient({
      baseUrl: this.config.baseUrl,
      token: this.config.apiKey,
      timeoutMs: this.writeBudgetMs,
      // Repeated writes are explicitly admitted through the durable receipt store.
      retryPolicy: { maxAttempts: 1 },
    });
  }

  async supports(
    controls?: MemorySearchRequestControls,
  ): Promise<MemorySearchIndexCapabilities> {
    return this.sanitized(async () => {
      const budget = readBudget(controls);
      const capability = await this.retrievalCapability(budget);
      const lanes = capability.required_provider_lanes;
      if (
        lanes.includes("postgres_keyword") &&
        lanes.includes("qdrant_dense")
      ) {
        return { capabilities: ["full_text", "semantic_vector", "hybrid"] };
      }
      if (lanes.includes("postgres_keyword"))
        return { capabilities: ["full_text"] };
      if (lanes.includes("qdrant_dense"))
        return { capabilities: ["semantic_vector"] };
      return { capabilities: [] };
    });
  }

  async search(
    input: MemorySearchIndexInput,
    controls?: MemorySearchRequestControls,
  ): Promise<readonly MemorySearchIndexResult[]> {
    return this.sanitized(async () => {
      const budget = readBudget(controls);
      remainingMs(budget);
      const sourceKeys = authorizedSourceKeys(this.indexIdentity, input);
      if (sourceKeys.length === 0) return [];
      const covered = await this.receipts.hasCoverage({
        indexIdentity: this.indexIdentity,
        scope: input,
      });
      if (!covered) throw failure("memory_index_incomplete");
      const capability = await this.retrievalCapability(budget);
      const request = this.retrievalRequest(input, sourceKeys, budget);
      const response = await this.client.context.retrieve(
        request,
        capability,
        this.requiredCapability(),
        sdkControls(budget),
      );
      // Contract-C v2 calls an empty, healthy top-k result "unqualified".
      // Provider evidence distinguishes this ordinary no-match from an outage.
      if (
        response.status === "unqualified" &&
        response.candidates.length === 0 &&
        response.degradation_reason_codes.length === 0 &&
        response.provider_outcomes.every(
          (provider) =>
            provider.status === "available" && provider.reason_code === null,
        )
      ) {
        return [];
      }
      if (
        response.status !== "available" ||
        response.degradation_reason_codes.length !== 0 ||
        response.provider_outcomes.some(
          (provider) => provider.status !== "available",
        )
      ) {
        throw failure("memory_index_unavailable");
      }
      const receiptIds = response.candidates.map((candidate) =>
        receiptIdFromLocator(this.indexIdentity, candidate.locator),
      );
      if (receiptIds.some((id) => id === null))
        throw failure("memory_index_stale");
      const receipts = await this.receipts.findByReceiptIds({
        indexIdentity: this.indexIdentity,
        receiptIds: receiptIds.filter((id): id is string => id !== null),
      });
      remainingMs(budget);
      const byId = new Map(receipts.map((receipt) => [receipt.id, receipt]));
      const seen = new Set<string>();
      const hits: MemorySearchIndexResult[] = [];
      for (const candidate of response.candidates) {
        const id = receiptIdFromLocator(this.indexIdentity, candidate.locator);
        const receipt = id === null ? undefined : byId.get(id);
        if (
          receipt === undefined ||
          receipt.indexIdentity !== this.indexIdentity ||
          receipt.state !== "indexed" ||
          receipt.deleteRequested ||
          !receipt.isCurrent ||
          !receiptIsAuthorized(receipt, input) ||
          receipt.remoteDocumentId !== candidate.document_key
        ) {
          throw failure("memory_index_stale");
        }
        const identity = projectionIdentity(receipt);
        if (
          identity.locator !== candidate.locator ||
          identity.sourceKey !== candidate.source_key ||
          !sourceKeys.includes(candidate.source_key)
        ) {
          throw failure("memory_index_stale");
        }
        if (seen.has(receipt.memoryItemId)) continue;
        seen.add(receipt.memoryItemId);
        hits.push({
          memoryItemId: receipt.memoryItemId,
          bodyVersion: receipt.bodyVersion,
          bodyHash: receipt.bodyHash,
          scope: receipt.scope,
          score: candidate.fused_score,
          explanationCode: capability.required_provider_lanes.includes(
            "qdrant_dense",
          )
            ? "semantic_match"
            : "lexical_match",
        });
      }
      return hits;
    });
  }

  async upsertDocument(
    input: MemoryIndexDocument,
  ): Promise<MemoryIndexWriteResult> {
    let receipt: MemoryProjectionReceipt | null = null;
    try {
      validateDocument(input);
      const budget = writeBudget(this.writeBudgetMs);
      receipt = await this.receipts.reserve({
        ...revisionOf(input),
        indexIdentity: this.indexIdentity,
      });
      if (receipt === null || receipt.state === "deleted")
        return { status: "superseded" };
      if (!receipt.isCurrent || receipt.deleteRequested) {
        await this.deleteDocument(revisionDelete(receipt));
        return { status: "superseded" };
      }
      const capability = await this.exactCapability(budget);
      if (receipt.state !== "reserved") {
        const observation = await this.observe(receipt, capability, budget);
        if (observation.document_id !== null) {
          receipt = await this.acknowledge(receipt, observation.document_id);
          return await this.finishUpsert(
            receipt,
            observation,
            capability,
            budget,
          );
        }
        if (observation.state !== "deleted_or_proven_absent") {
          throw failure("memory_index_unavailable");
        }
        if (receipt.remoteDocumentId !== null)
          throw failure("memory_index_conflict");
      }
      const admitted = await this.receipts.admitSend(receiptKey(receipt));
      if (admitted === null) {
        await this.receipts.requestDeletion({
          ...revisionDelete(receipt),
          indexIdentity: this.indexIdentity,
        });
        return { status: "superseded" };
      }
      receipt = admitted;
      const identity = projectionIdentity(receipt);
      const response = await this.client.documents.ingestDocument({
        spaceId: this.config.spaceId,
        memoryScopeId: this.config.memoryScopeId,
        title: projectionTitle,
        text: input.body,
        sourceType,
        sourceExternalId: identity.sourceExternalId,
        classification: "internal",
        idempotencyKey: identity.idempotencyKey,
        retrievalProjection: {
          schemaVersion: "document-retrieval-projection.v1",
          locator: identity.locator,
          sourceKey: identity.sourceKey,
          projectionGeneration: this.config.projectionGeneration,
          sequenceOrdinal: receipt.sequenceOrdinal,
          actorKeys: [],
          timeInterval: null,
          relativeTimeInterval: null,
          kind: "confirmed_review_memory",
          category: "review_memory",
          tags: [],
        },
        ...sdkControls(budget),
      });
      const document = this.documentRecord(response.data, receipt);
      if (document.chunks !== 1) throw failure("memory_index_conflict");
      receipt = await this.acknowledge(receipt, document.id);
      const observation = await this.observe(receipt, capability, budget);
      return await this.finishUpsert(receipt, observation, capability, budget);
    } catch (error) {
      const safe = sanitize(error);
      if (receipt !== null) await this.defer(receipt, safe.code);
      throw safe;
    }
  }

  async deleteDocument(input: MemoryIndexDeleteInput): Promise<void> {
    return this.sanitized(async () => {
      await this.receipts.requestDeletion({
        ...input,
        indexIdentity: this.indexIdentity,
      });
      const batch = await this.receipts.listForDeletion({
        ...input,
        indexIdentity: this.indexIdentity,
        limit: cleanupBatchLimit,
      });
      if (batch.length === 0) return;
      const budget = writeBudget(this.writeBudgetMs);
      let capability: ExactDocumentReconciliationCapabilityV1 | undefined;
      let failed = false;
      for (const receipt of batch) {
        // Leave unattempted receipts due; an exhausted pass is not their failure.
        if (!canStartReceipt(budget)) break;
        try {
          capability ??= await this.exactCapability(budget);
          await this.cleanup(receipt, capability, budget);
        } catch (error) {
          failed = true;
          await this.defer(receipt, sanitize(error).code);
        }
      }
      const remaining = await this.receipts.listForDeletion({
        ...input,
        indexIdentity: this.indexIdentity,
        limit: 1,
      });
      if (failed || remaining.length > 0) throw failure("memory_index_pending");
    });
  }

  async reconcilePending(
    input: { readonly limit?: number } = {},
  ): Promise<MemoryProjectionMaintenanceResult> {
    return this.sanitized(async () => {
      const batch = await this.receipts.listDue({
        indexIdentity: this.indexIdentity,
        limit: boundedBatch(input.limit),
        now: new Date(),
      });
      return this.reconcileBatch(batch, false);
    });
  }

  /** Writers must be stopped by the operator before this bounded drain pass. */
  async drain(
    input: { readonly limit?: number } = {},
  ): Promise<MemoryProjectionMaintenanceResult> {
    return this.sanitized(async () => {
      const batch = await this.receipts.listOutstanding({
        indexIdentity: this.indexIdentity,
        limit: boundedBatch(input.limit),
      });
      const result = await this.reconcileBatch(batch, true);
      const remaining = await this.receipts.listOutstanding({
        indexIdentity: this.indexIdentity,
        limit: 1,
      });
      if (remaining.length === 0) {
        await this.receipts.retireIndexIdentity(this.indexIdentity);
      }
      return { ...result, pending: Math.max(result.pending, remaining.length) };
    });
  }

  private async reconcileBatch(
    batch: readonly MemoryProjectionReceipt[],
    draining: boolean,
  ): Promise<MemoryProjectionMaintenanceResult> {
    const budget = writeBudget(this.writeBudgetMs);
    let capability: ExactDocumentReconciliationCapabilityV1 | undefined;
    let processed = 0;
    let deleted = 0;
    let pending = 0;
    for (let receipt of batch) {
      if (!canStartReceipt(budget)) break;
      processed += 1;
      try {
        if (draining || receipt.deleteRequested || !receipt.isCurrent) {
          await this.receipts.requestDeletion({
            ...revisionDelete(receipt),
            indexIdentity: this.indexIdentity,
          });
          const refreshed = await this.receipts.findByReceiptIds({
            indexIdentity: this.indexIdentity,
            receiptIds: [receipt.id],
          });
          const latest = refreshed[0];
          if (latest === undefined) throw failure("memory_index_conflict");
          receipt = latest;
          if (receipt.state !== "deleted") {
            capability ??= await this.exactCapability(budget);
            await this.cleanup(receipt, capability, budget);
          }
          deleted += 1;
        } else if (receipt.state === "reserved") {
          // Only the canonical outbox handler can supply a body for a new write.
          throw failure("memory_index_pending");
        } else {
          capability ??= await this.exactCapability(budget);
          const observation = await this.observe(receipt, capability, budget);
          if (observation.document_id === null) {
            throw failure("memory_index_unknown_write");
          }
          receipt = await this.acknowledge(receipt, observation.document_id);
          await this.finishUpsert(receipt, observation, capability, budget);
        }
      } catch (error) {
        pending += 1;
        await this.defer(receipt, sanitize(error).code);
      }
    }
    return { processed, deleted, pending: pending + batch.length - processed };
  }

  private async finishUpsert(
    receipt: MemoryProjectionReceipt,
    observation: ExactDocumentReconciliationResultV1,
    capability: ExactDocumentReconciliationCapabilityV1,
    budget: MemorySearchRequestControls,
  ): Promise<MemoryIndexWriteResult> {
    if (!receipt.isCurrent || receipt.deleteRequested) {
      await this.receipts.requestDeletion({
        ...revisionDelete(receipt),
        indexIdentity: this.indexIdentity,
      });
      await this.cleanup(receipt, capability, budget);
      return { status: "superseded" };
    }
    if (
      observation.state !== "indexed" ||
      observation.visibility !== "indexed" ||
      observation.canonical_status !== "active" ||
      observation.document_id === null
    ) {
      throw failure(
        observation.state === "deleted_or_proven_absent"
          ? "memory_index_conflict"
          : "memory_index_pending",
      );
    }
    const indexed = await this.receipts.markIndexed({
      ...receiptKey(receipt),
      remoteDocumentId: observation.document_id,
    });
    if (
      indexed.state === "indexed" &&
      indexed.isCurrent &&
      !indexed.deleteRequested
    ) {
      return { status: "indexed" };
    }
    await this.receipts.requestDeletion({
      ...revisionDelete(indexed),
      indexIdentity: this.indexIdentity,
    });
    await this.cleanup(indexed, capability, budget);
    return { status: "superseded" };
  }

  private async cleanup(
    receipt: MemoryProjectionReceipt,
    capability: ExactDocumentReconciliationCapabilityV1,
    budget: MemorySearchRequestControls,
  ): Promise<void> {
    const observation = await this.observe(receipt, capability, budget);
    if (observation.document_id !== null) {
      receipt = await this.acknowledge(receipt, observation.document_id);
    }
    if (observation.state === "deleted_or_proven_absent") {
      if (receipt.remoteDocumentId === null) {
        throw failure("memory_index_unknown_write");
      }
      await this.receipts.markDeleted({
        ...receiptKey(receipt),
        remoteDocumentId: receipt.remoteDocumentId,
      });
      return;
    }
    if (receipt.remoteDocumentId === null)
      throw failure("memory_index_unknown_write");
    const response = await this.client.documents.deleteDocument(
      receipt.remoteDocumentId,
      sdkControls(budget),
    );
    const document = this.documentRecord(response.data, receipt);
    if (
      document.id !== receipt.remoteDocumentId ||
      (document.status !== "deleted" && document.status !== "superseded")
    ) {
      throw failure("memory_index_conflict");
    }
    await this.receipts.markDeleted({
      ...receiptKey(receipt),
      remoteDocumentId: receipt.remoteDocumentId,
    });
  }

  private async observe(
    receipt: MemoryProjectionReceipt,
    capability: ExactDocumentReconciliationCapabilityV1,
    budget: MemorySearchRequestControls,
  ): Promise<ExactDocumentReconciliationResultV1> {
    const identity = projectionIdentity(receipt);
    const remaining = remainingMs(budget);
    if (remaining < minimumReconciliationBudgetMs)
      throw failure("memory_index_deadline");
    const deadlineMs = Math.min(remaining, capability.max_deadline_ms, 10_000);
    const result = await this.client.documents.reconcileExactDocument({
      capability,
      spaceId: this.config.spaceId,
      memoryScopeId: this.config.memoryScopeId,
      sourceType,
      sourceExternalId: identity.sourceExternalId,
      idempotencyKey: identity.idempotencyKey,
      // SDK 0.2.4 rejects legitimate absent responses with optional generation
      // filters. Source identity already binds generation; validate found rows below.
      deadlineMs,
      ...sdkControls(budget),
      timeoutMs: Math.min(remainingMs(budget), deadlineMs + 250),
    });
    if (result.state === "conflict") throw failure("memory_index_conflict");
    if (result.state === "unavailable")
      throw failure("memory_index_unavailable");
    if (result.document_id !== null) {
      if (
        !isNativeDocumentId(result.document_id) ||
        result.projection_generation !== this.config.projectionGeneration ||
        result.idempotency_key_matches === false ||
        (receipt.remoteDocumentId === null &&
          result.idempotency_key_matches !== true) ||
        (receipt.remoteDocumentId !== null &&
          receipt.remoteDocumentId !== result.document_id)
      ) {
        throw failure("memory_index_conflict");
      }
      if (
        result.state === "deleted_or_proven_absent" &&
        result.canonical_status !== "deleted" &&
        result.canonical_status !== "superseded"
      ) {
        throw failure("memory_index_conflict");
      }
    } else if (result.state !== "deleted_or_proven_absent") {
      throw failure("memory_index_conflict");
    }
    return result;
  }

  private acknowledge(
    receipt: MemoryProjectionReceipt,
    remoteDocumentId: string,
  ): Promise<MemoryProjectionReceipt> {
    return this.receipts.recordAcknowledgement({
      ...receiptKey(receipt),
      remoteDocumentId,
    });
  }

  private async retrievalCapability(
    budget: MemorySearchRequestControls,
  ): Promise<RetrievalCapability> {
    const capabilities = await this.capabilities(budget);
    const capability = assertRetrievalCapability(
      capabilities,
      this.requiredCapability(),
    );
    await verifyRetrievalCapabilityFingerprint(capability);
    remainingMs(budget);
    if (
      !capability.hard_filter_signals.includes("source_generations") ||
      capability.provider_lanes.some(
        (lane) => lane.required && (!lane.healthy || !lane.profile_qualified),
      )
    ) {
      throw failure("memory_index_unavailable");
    }
    return capability;
  }

  private async exactCapability(
    budget: MemorySearchRequestControls,
  ): Promise<ExactDocumentReconciliationCapabilityV1> {
    const capabilities = await this.capabilities(budget);
    const capability = capabilities.documents?.exact_reconciliation;
    assertExactDocumentReconciliationCapabilityV1(capability);
    return capability;
  }

  private capabilities(
    budget: MemorySearchRequestControls,
  ): Promise<InfinityContextCapabilities> {
    return this.client.system.capabilities(sdkControls(budget));
  }

  private requiredCapability(): {
    readonly capabilityFingerprint: string;
    readonly profileId: string;
    readonly requiredProviderLanes: readonly string[];
  } {
    return {
      capabilityFingerprint: this.config.capabilityFingerprint,
      profileId: this.config.profileId,
      requiredProviderLanes: this.config.requiredProviderLanes,
    };
  }

  private retrievalRequest(
    input: MemorySearchIndexInput,
    sourceKeys: readonly string[],
    budget: MemorySearchRequestControls,
  ): RetrieveContextInput {
    const query = normalizeMemoryBody(input.safeQuery);
    if (query.length === 0 || [...query].length > 512) {
      throw failure("memory_index_document_invalid");
    }
    const resultLimit = Math.min(50, Math.max(1, Math.trunc(input.limit)));
    return {
      contractVersion: "context-retrieval.v2",
      capabilityFingerprint: this.config.capabilityFingerprint,
      profileId: this.config.profileId,
      scope: {
        spaceId: this.config.spaceId,
        memoryScopeId: this.config.memoryScopeId,
      },
      queries: [{ queryId: "memory", query, weightMicros: 1_000_000 }],
      filters: {
        sourceGenerations: sourceKeys.map((sourceKey) => ({
          sourceKey,
          projectionGeneration: this.config.projectionGeneration,
        })),
        excludedSourceKeys: [],
        documentKeys: [],
        kinds: [],
        category: null,
        tagsAny: [],
        tagsAll: [],
        tagsNone: [],
        actorKeys: [],
        timeInterval: null,
        relativeTimeInterval: null,
      },
      softPreferences: {
        sourcePreferences: [],
        actorPreferences: [],
        timeInterval: null,
        relativeTimeInterval: null,
        timeWeightMicros: null,
      },
      bounds: {
        candidateLimit: Math.min(1_000, resultLimit * 4),
        resultLimit,
        neighborRadius: 0,
        responseByteLimit,
        deadlineMs: Math.min(2_000, remainingMs(budget)),
      },
    };
  }

  private documentRecord(
    value: unknown,
    receipt: MemoryProjectionReceipt,
  ): {
    readonly id: string;
    readonly status: unknown;
    readonly chunks: unknown;
  } {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw failure("memory_index_conflict");
    }
    const document = value as Record<string, unknown>;
    const identity = projectionIdentity(receipt);
    if (
      !isNativeDocumentId(document.id) ||
      document.space_id !== this.config.spaceId ||
      document.memory_scope_id !== this.config.memoryScopeId ||
      document.thread_id !== null ||
      document.source_type !== sourceType ||
      document.source_external_id !== identity.sourceExternalId ||
      document.classification !== "internal"
    ) {
      throw failure("memory_index_conflict");
    }
    return {
      id: document.id,
      status: document.status,
      chunks: document.chunks,
    };
  }

  private async defer(
    receipt: MemoryProjectionReceipt,
    code: string,
  ): Promise<void> {
    await this.sanitized(async () => {
      await this.receipts.defer({
        ...receiptKey(receipt),
        nextAttemptAt: new Date(Date.now() + retryDelayMs),
        reasonCode:
          code === "memory_index_pending" ||
          code === "memory_index_conflict" ||
          code === "memory_index_unknown_write"
            ? code
            : "memory_index_unavailable",
      });
    });
  }

  private async sanitized<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw sanitize(error);
    }
  }
}

function revisionOf(input: MemoryIndexDocument): MemoryProjectionRevision {
  return {
    workspaceId: input.workspaceId,
    memoryItemId: input.memoryItemId,
    repositoryId: input.repositoryId,
    userId: input.userId,
    scope: input.scope,
    bodyVersion: input.bodyVersion,
    bodyHash: input.bodyHash,
  };
}

function validateDocument(input: MemoryIndexDocument): void {
  if (
    input.body.length === 0 ||
    input.body.length > memoryBodyMaxCharacters ||
    normalizeMemoryBody(input.body) !== input.body ||
    createMemoryBodyHash(input.body) !== input.bodyHash ||
    !Number.isSafeInteger(input.bodyVersion) ||
    input.bodyVersion < 1
  ) {
    throw failure("memory_index_document_invalid");
  }
}

function revisionDelete(
  receipt: MemoryProjectionReceipt,
): MemoryIndexDeleteInput {
  return {
    workspaceId: receipt.workspaceId,
    memoryItemId: receipt.memoryItemId,
    target: {
      kind: "revision",
      bodyVersion: receipt.bodyVersion,
      bodyHash: receipt.bodyHash,
    },
  };
}

function receiptKey(receipt: MemoryProjectionReceipt): {
  readonly indexIdentity: string;
  readonly receiptId: string;
} {
  return { indexIdentity: receipt.indexIdentity, receiptId: receipt.id };
}

function readBudget(
  controls?: MemorySearchRequestControls,
): MemorySearchRequestControls {
  return controls ?? { deadlineAtMs: Date.now() + defaultReadBudgetMs };
}

function writeBudget(milliseconds: number): MemorySearchRequestControls {
  return { deadlineAtMs: Date.now() + milliseconds };
}

function canStartReceipt(budget: MemorySearchRequestControls): boolean {
  return (
    !budget.signal?.aborted &&
    budget.deadlineAtMs - Date.now() >= minimumReconciliationBudgetMs
  );
}

function remainingMs(budget: MemorySearchRequestControls): number {
  const remaining = Math.floor(budget.deadlineAtMs - Date.now());
  if (
    budget.signal?.aborted ||
    !Number.isSafeInteger(remaining) ||
    remaining < 1
  ) {
    throw failure("memory_index_deadline");
  }
  return remaining;
}

function sdkControls(budget: MemorySearchRequestControls): {
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
} {
  return {
    timeoutMs: remainingMs(budget),
    ...(budget.signal === undefined ? {} : { signal: budget.signal }),
  };
}

function boundedBatch(limit: number | undefined): number {
  if (limit === undefined) return cleanupBatchLimit;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw failure("memory_index_document_invalid");
  }
  return limit;
}

function failure(code: string): MemoryIndexOperationError {
  return new MemoryIndexOperationError(code);
}

/** SDK document routes interpolate the ID; admit only native server identifier syntax. */
function isNativeDocumentId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/u.test(value);
}

function sanitize(error: unknown): MemoryIndexOperationError {
  return failure(safeMemoryIndexErrorCode(error) ?? "memory_index_unavailable");
}
