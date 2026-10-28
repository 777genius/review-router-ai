import {
  createClient,
  createConfig,
  sdk,
  type Client,
} from "@vectorize-io/hindsight-client";
import type {
  CurrentSource,
  CurrentSourceReader,
  ExactStatementWriter,
  MemoryOperationReader,
  MemoryRecallReader,
  RequestControls,
  SourceRef,
  NativeOperation,
  RecalledEvidence,
} from "../contracts.js";

export class MemoryEngineError extends Error {
  constructor(
    readonly code:
      | "unavailable"
      | "incomplete"
      | "deadline"
      | "invalid_input"
      | "unknown_write",
  ) {
    super(`memory_engine_${code}`);
  }
}
/** Native mechanism only. Product approval, scopes, CAS, revocation and full forget stay outside. */
export class HindsightMemoryStore
  implements
    CurrentSourceReader,
    ExactStatementWriter,
    MemoryOperationReader,
    MemoryRecallReader
{
  private readonly client: Client;
  constructor(
    private readonly config: {
      readonly baseUrl: string;
      readonly apiKey: string;
      readonly bankForScope: (scope: string) => string;
      readonly exactStatementStrategy: string;
      readonly fetch?: typeof fetch;
    },
  ) {
    this.client = createClient(
      createConfig({
        baseUrl: config.baseUrl,
        headers: { Authorization: `Bearer ${config.apiKey}` },
        ...(config.fetch ? { fetch: config.fetch } : {}),
      }),
    );
  }
  private path(scope: string) {
    return { bank_id: this.config.bankForScope(scope) };
  }
  private signal(controls: RequestControls) {
    const remaining = controls.deadlineAt.getTime() - Date.now();
    if (remaining <= 0 || controls.signal?.aborted)
      throw new MemoryEngineError("deadline");
    const timeout = AbortSignal.timeout(remaining);
    return controls.signal
      ? AbortSignal.any([controls.signal, timeout])
      : timeout;
  }
  private async result<T>(
    work: Promise<{ data?: T; error?: unknown; response?: Response }>,
    controls: RequestControls,
    missing = false,
  ): Promise<T | null> {
    try {
      const result = await work;
      this.signal(controls);
      if (missing && result.response?.status === 404) return null;
      if (
        !result.response?.ok ||
        result.error !== undefined ||
        !result.data ||
        typeof result.data !== "object" ||
        Array.isArray(result.data)
      )
        throw new MemoryEngineError("unavailable");
      return result.data;
    } catch (error) {
      if (error instanceof MemoryEngineError) throw error;
      throw new MemoryEngineError(
        controls.signal?.aborted || Date.now() >= controls.deadlineAt.getTime()
          ? "deadline"
          : "unavailable",
      );
    }
  }
  async readSource(
    ref: SourceRef,
    controls: RequestControls,
  ): Promise<CurrentSource | null> {
    const document = await this.result(
      sdk.getDocument({
        client: this.client,
        path: { ...this.path(ref.scope), document_id: ref.id },
        signal: this.signal(controls),
      }),
      controls,
      true,
    );
    if (document === null) return null;
    if (
      document.id !== ref.id ||
      document.bank_id !== this.path(ref.scope).bank_id ||
      typeof document.original_text !== "string" ||
      !Array.isArray(document.tags) ||
      document.tags.some((tag) => typeof tag !== "string") ||
      !document.document_metadata ||
      typeof document.document_metadata !== "object" ||
      Array.isArray(document.document_metadata) ||
      Object.values(document.document_metadata).some(
        (value) => typeof value !== "string",
      )
    )
      throw new MemoryEngineError("incomplete");
    return {
      ref,
      body: document.original_text,
      metadata: document.document_metadata as Record<string, string>,
      tags: document.tags,
    };
  }
  async listSources(
    input: Parameters<CurrentSourceReader["listSources"]>[0],
    controls: RequestControls,
  ): ReturnType<CurrentSourceReader["listSources"]> {
    const offset = input.cursor ? Number(input.cursor) : 0;
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 100
    )
      throw new MemoryEngineError("invalid_input");
    const page = await this.result(
      sdk.listDocuments({
        client: this.client,
        path: this.path(input.scope),
        query: {
          limit: input.limit,
          offset,
          ...(input.tags
            ? { tags: [...input.tags], tags_match: "all" as const }
            : {}),
        },
        signal: this.signal(controls),
      }),
      controls,
      true,
    );
    if (page === null) return { sources: [], nextCursor: null };
    if (
      !Array.isArray(page.items) ||
      page.items.length > input.limit ||
      page.items.some(
        (item) =>
          !item || typeof item !== "object" || typeof item.id !== "string",
      )
    )
      throw new MemoryEngineError("incomplete");
    return {
      sources: page.items.map((item) => ({ scope: input.scope, id: item.id })),
      nextCursor:
        page.items.length === input.limit
          ? String(offset + page.items.length)
          : null,
    };
  }
  async replaceSource(
    input: Parameters<ExactStatementWriter["replaceSource"]>[0],
    controls: RequestControls,
  ): ReturnType<ExactStatementWriter["replaceSource"]> {
    if (
      !input.source.body ||
      input.source.body.length > 1000 ||
      !Number.isFinite(Date.parse(input.statementAt)) ||
      !this.config.exactStatementStrategy
    )
      throw new MemoryEngineError("invalid_input");
    const accepted = await this.result(
      sdk.retainMemories({
        client: this.client,
        path: this.path(input.source.ref.scope),
        body: {
          async: true,
          operation_id: input.operationId,
          items: [
            {
              content: input.source.body,
              document_id: input.source.ref.id,
              timestamp: input.statementAt,
              strategy: this.config.exactStatementStrategy,
              update_mode: "replace",
              tags: [...input.source.tags],
              observation_scopes: [[...input.derivationTags]],
              entities: [],
              resolve_entities: false,
              metadata: { ...input.source.metadata },
            },
          ],
        },
        signal: this.signal(controls),
      }),
      controls,
    );
    if (!accepted?.success || accepted.operation_id !== input.operationId)
      throw new MemoryEngineError("unknown_write");
    return { id: input.operationId, state: "submitted" };
  }
  async operation(
    input: Parameters<MemoryOperationReader["operation"]>[0],
    controls: RequestControls,
  ): Promise<NativeOperation | null> {
    const status = await this.result(
      sdk.getOperationStatus({
        client: this.client,
        path: { ...this.path(input.scope), operation_id: input.id },
        query: { include_payload: false },
        signal: this.signal(controls),
      }),
      controls,
      true,
    );
    if (status === null) return null;
    if (
      typeof status.status !== "string" ||
      !status.status ||
      (status.operation_type != null &&
        typeof status.operation_type !== "string") ||
      (status.child_operations != null &&
        (!Array.isArray(status.child_operations) ||
          status.child_operations.some(
            (child) =>
              !child ||
              typeof child !== "object" ||
              typeof child.operation_id !== "string" ||
              typeof child.status !== "string",
          )))
    )
      throw new MemoryEngineError("incomplete");
    if (status.status === "not_found") return null;
    const state = [
      "pending",
      "processing",
      "completed",
      "failed",
      "cancelled",
    ].includes(status.status)
      ? (status.status as NativeOperation["state"])
      : "unknown";
    return {
      id: input.id,
      state,
      kind: status.operation_type ?? null,
      children: (status.child_operations ?? []).map((child) => ({
        id: child.operation_id,
        state: child.status,
      })),
    };
  }
  async recallEvidence(
    input: Parameters<MemoryRecallReader["recallEvidence"]>[0],
    controls: RequestControls,
  ): Promise<readonly RecalledEvidence[]> {
    if (
      !input.query.trim() ||
      input.query.length > 1000 ||
      input.limit < 1 ||
      input.limit > 20
    )
      throw new MemoryEngineError("invalid_input");
    const recalled = await this.result(
      sdk.recallMemories({
        client: this.client,
        path: this.path(input.scope),
        body: {
          query: input.query,
          types: ["world", "experience", "observation"],
          budget: "low",
          max_tokens: 4000,
          include: {
            source_facts: {
              max_tokens: 6000,
              max_tokens_per_observation: 2000,
            },
          },
          ...(input.tags
            ? { tags: [...input.tags], tags_match: "all" as const }
            : {}),
          trace: false,
        },
        signal: this.signal(controls),
      }),
      controls,
      true,
    );
    if (recalled === null) return [];
    if (
      !Array.isArray(recalled.results) ||
      recalled.results.some(
        (fact) =>
          !fact ||
          typeof fact !== "object" ||
          typeof fact.id !== "string" ||
          typeof fact.text !== "string" ||
          typeof fact.type !== "string" ||
          (fact.source_fact_ids != null &&
            (!Array.isArray(fact.source_fact_ids) ||
              fact.source_fact_ids.some((id) => typeof id !== "string"))) ||
          (fact.document_id != null && typeof fact.document_id !== "string"),
      ) ||
      (recalled.source_facts != null &&
        (typeof recalled.source_facts !== "object" ||
          Array.isArray(recalled.source_facts) ||
          Object.values(recalled.source_facts).some(
            (fact) =>
              !fact ||
              typeof fact !== "object" ||
              (fact.document_id != null &&
                typeof fact.document_id !== "string"),
          )))
    )
      throw new MemoryEngineError("incomplete");
    return recalled.results.slice(0, input.limit).map((fact) => {
      const ids =
        fact.type === "observation" ? (fact.source_fact_ids ?? []) : [fact.id];
      const sources = ids.map((id) =>
        fact.type !== "observation"
          ? fact.document_id
          : recalled.source_facts?.[id]?.document_id,
      );
      return {
        id: fact.id,
        body: fact.text,
        type: fact.type === "observation" ? "observation" : "source",
        sourceFactIds: ids,
        sourceIds: [
          ...new Set(
            sources.filter((id): id is string => typeof id === "string"),
          ),
        ],
        evidenceComplete:
          ids.length > 0 && sources.every((id) => typeof id === "string"),
      };
    });
  }
}
