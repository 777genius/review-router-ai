import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import {
  parseMemorySearchConfig,
  type InfinityMemorySearchConfig,
} from "../infrastructure/config/memory-search-config";

export type InfinityCapturedRequest = {
  readonly method: string;
  readonly path: string;
  readonly authorization: string | undefined;
  readonly idempotencyKey: string | undefined;
  readonly rawBody: string;
  readonly body: Record<string, unknown>;
};

export type InfinityFixtureDocument = {
  readonly id: string;
  readonly request: InfinityCapturedRequest;
  status: "active" | "deleted";
  indexed: boolean;
};

/**
 * Test-only HTTP peer for the published SDK. Its synthetic capability is the
 * upstream SDK's Contract-C v2 golden profile. This fixture does not start or
 * qualify an Infinity server and provides no retrieval-quality evidence.
 */
export class InfinityProtocolFixture {
  readonly requests: InfinityCapturedRequest[] = [];
  readonly documents = new Map<string, InfinityFixtureDocument>();
  autoIndex = true;
  capabilitiesDelayMs = 0;
  omitRetrievalCapability = false;
  dropNextIngestAcknowledgement = false;
  dropNextDeleteAcknowledgement = false;
  rejectNextIngestWith: string | undefined;
  beforeIngest:
    | ((request: InfinityCapturedRequest) => Promise<void>)
    | undefined;
  afterIngest:
    | ((document: InfinityFixtureDocument) => Promise<void>)
    | undefined;
  retrievalTransform:
    | ((
        response: Record<string, unknown>,
        request: InfinityCapturedRequest,
      ) => Record<string, unknown>)
    | undefined;
  reconciliationTransform:
    | ((
        response: Record<string, unknown>,
        request: InfinityCapturedRequest,
      ) => Record<string, unknown>)
    | undefined;
  readonly server = createServer((request, response) => {
    void this.serve(request, response).catch(() => {
      if (!response.destroyed && !response.headersSent) {
        respond(response, 500, {
          error: { code: "fixture_failure", message: "Test fixture failure" },
        });
      }
    });
  });

  static async start(): Promise<InfinityProtocolFixture> {
    const fixture = new InfinityProtocolFixture();
    await new Promise<void>((resolve, reject) => {
      fixture.server.once("error", reject);
      fixture.server.listen(0, "127.0.0.1", resolve);
    });
    return fixture;
  }

  get config(): InfinityMemorySearchConfig {
    const address = this.server.address() as AddressInfo;
    const config = parseMemorySearchConfig({
      REVIEW_ROUTER_MEMORY_SEARCH_ENGINE: "infinity",
      REVIEW_ROUTER_MEMORY_INFINITY_BASE_URL: `http://127.0.0.1:${address.port}`,
      REVIEW_ROUTER_MEMORY_INFINITY_API_KEY: "test-infinity-service-token",
      REVIEW_ROUTER_MEMORY_INFINITY_SPACE_ID: "test-space",
      REVIEW_ROUTER_MEMORY_INFINITY_MEMORY_SCOPE_ID: "test-scope",
      REVIEW_ROUTER_MEMORY_INFINITY_PROJECTION_GENERATION: "test-generation-1",
      REVIEW_ROUTER_MEMORY_INFINITY_PROFILE_ID: capability.profile_id,
      REVIEW_ROUTER_MEMORY_INFINITY_CAPABILITY_FINGERPRINT:
        capability.capability_fingerprint,
      REVIEW_ROUTER_MEMORY_INFINITY_REQUIRED_PROVIDER_LANES:
        "postgres_keyword,qdrant_dense",
    });
    if (config.kind !== "infinity") throw new Error("fixture_config_invalid");
    return config;
  }

  async close(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  /** Simulates a server transaction completing after the consumer lost its reply. */
  commitIngest(request: InfinityCapturedRequest): InfinityFixtureDocument {
    const source = String(request.body.source_external_id);
    const previous = this.documents.get(source);
    if (previous !== undefined) {
      if (previous.request.rawBody !== request.rawBody)
        throw new Error("fixture_idempotency_conflict");
      return previous;
    }
    const document: InfinityFixtureDocument = {
      id: `doc_${this.documents.size + 1}`,
      request,
      status: "active",
      indexed: this.autoIndex,
    };
    this.documents.set(source, document);
    return document;
  }

  private async serve(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const rawBody = Buffer.concat(chunks).toString("utf8");
    const captured: InfinityCapturedRequest = {
      method: request.method ?? "GET",
      path: new URL(request.url ?? "/", "http://fixture.invalid").pathname,
      authorization: request.headers.authorization,
      idempotencyKey: singleHeader(request.headers["idempotency-key"]),
      rawBody,
      body: rawBody ? record(JSON.parse(rawBody)) : {},
    };
    this.requests.push(captured);
    if (captured.authorization !== `Bearer ${this.config.apiKey}`) {
      respond(response, 401, {
        error: { code: "unauthorized", message: "Unauthorized" },
      });
      return;
    }
    if (captured.method === "GET" && captured.path === "/v1/capabilities") {
      if (this.capabilitiesDelayMs > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, this.capabilitiesDelayMs),
        );
      }
      respond(response, 200, {
        ...(this.omitRetrievalCapability
          ? {}
          : { context: { retrieval: capability } }),
        documents: { exact_reconciliation: reconciliationCapability },
      });
      return;
    }
    if (captured.method === "POST" && captured.path === "/v1/documents") {
      if (this.rejectNextIngestWith !== undefined) {
        const message = this.rejectNextIngestWith;
        this.rejectNextIngestWith = undefined;
        respond(response, 503, {
          error: {
            code: "memory.document_projection_unavailable",
            message,
            retryable: true,
          },
        });
        return;
      }
      await this.beforeIngest?.(captured);
      const document = this.commitIngest(captured);
      await this.afterIngest?.(document);
      if (this.dropNextIngestAcknowledgement) {
        this.dropNextIngestAcknowledgement = false;
        response.destroy();
        return;
      }
      respond(response, 201, { data: documentRecord(document) });
      return;
    }
    if (
      captured.method === "POST" &&
      captured.path === "/v1/documents/reconcile-exact"
    ) {
      const document = this.documents.get(
        String(captured.body.source_external_id),
      );
      const projection =
        document === undefined
          ? null
          : record(document.request.body.retrieval_projection);
      const state =
        document === undefined || document.status === "deleted"
          ? "deleted_or_proven_absent"
          : document.indexed
            ? "indexed"
            : "present";
      const result: Record<string, unknown> = {
        contract_version: "document-reconciliation.v1",
        state,
        scope: {
          space_id: captured.body.space_id,
          memory_scope_id: captured.body.memory_scope_id,
          thread_id: null,
        },
        source_type: captured.body.source_type,
        source_external_id: captured.body.source_external_id,
        document_id: document?.id ?? null,
        canonical_status: document?.status ?? null,
        projection_generation: projection?.projection_generation ?? null,
        profile_generation:
          document === undefined ? null : "fixture-profile-generation",
        visibility:
          state === "indexed"
            ? "indexed"
            : state === "present"
              ? "accepted"
              : "not_queryable",
        idempotency_key_matches:
          document === undefined
            ? null
            : document.request.idempotencyKey === captured.body.idempotency_key,
      };
      respond(response, 200, {
        data: this.reconciliationTransform?.(result, captured) ?? result,
      });
      return;
    }
    if (
      captured.method === "DELETE" &&
      captured.path.startsWith("/v1/documents/")
    ) {
      const id = captured.path.slice("/v1/documents/".length);
      const document = [...this.documents.values()].find(
        (candidate) => candidate.id === id,
      );
      if (document === undefined) {
        respond(response, 404, {
          error: { code: "not_found", message: "Not found" },
        });
      } else {
        document.status = "deleted";
        if (this.dropNextDeleteAcknowledgement) {
          this.dropNextDeleteAcknowledgement = false;
          response.destroy();
          return;
        }
        respond(response, 200, { data: documentRecord(document) });
      }
      return;
    }
    if (
      captured.method === "POST" &&
      captured.path === "/v1/context/retrieve"
    ) {
      const result = this.retrieve(captured);
      respond(
        response,
        200,
        this.retrievalTransform?.(result, captured) ?? result,
      );
      return;
    }
    respond(response, 404, {
      error: { code: "fixture_route_missing", message: "Test route missing" },
    });
  }

  private retrieve(request: InfinityCapturedRequest): Record<string, unknown> {
    const filters = record(request.body.filters);
    const pairs = filters.source_generations as readonly Record<
      string,
      unknown
    >[];
    const bounds = record(request.body.bounds);
    const queries = request.body.queries as readonly Record<string, unknown>[];
    const query = queries[0]!;
    const candidates = [...this.documents.values()]
      .filter((document) => {
        const projection = record(document.request.body.retrieval_projection);
        return (
          document.status === "active" &&
          document.indexed &&
          pairs.some(
            (pair) =>
              pair.source_key === projection.source_key &&
              pair.projection_generation === projection.projection_generation,
          ) &&
          String(document.request.body.text)
            .toLowerCase()
            .includes(String(query.query).toLowerCase())
        );
      })
      .slice(0, Number(bounds.result_limit))
      .map((document, index) =>
        candidateRecord(document, index + 1, String(query.query_id)),
      );
    return {
      contract_version: "context-retrieval.v2",
      ranking_policy: "weighted_rrf_canonical_preferences.v1",
      status: candidates.length > 0 ? "available" : "unqualified",
      capability_fingerprint: capability.capability_fingerprint,
      profile_id: capability.profile_id,
      coverage: "top_k_only",
      applied_bounds: {
        ...bounds,
        returned_seeds: candidates.length,
        returned_neighbors: 0,
      },
      candidates,
      provider_outcomes: [
        {
          provider_id: "postgres_keyword",
          status: "available",
          reason_code: null,
        },
        { provider_id: "qdrant_dense", status: "available", reason_code: null },
      ],
      degradation_reason_codes: [],
    };
  }
}

function documentRecord(
  document: InfinityFixtureDocument,
): Record<string, unknown> {
  const input = document.request.body;
  return {
    id: document.id,
    space_id: input.space_id,
    memory_scope_id: input.memory_scope_id,
    thread_id: null,
    title: input.title,
    source_type: input.source_type,
    source_external_id: input.source_external_id,
    classification: input.classification,
    status: document.status,
    chunks: 1,
    chunk_ids: [`chunk_${document.id}`],
    indexing_status: document.indexed
      ? "already_indexed_or_pending"
      : "pending",
  };
}

function candidateRecord(
  document: InfinityFixtureDocument,
  rank: number,
  queryId: string,
): Record<string, unknown> {
  const projection = record(document.request.body.retrieval_projection);
  const contribution = Math.round(1_000_000_000_000 / (60 + rank));
  const base = contribution * 2;
  return {
    locator: projection.locator,
    source_key: projection.source_key,
    document_key: document.id,
    chunk_key: `chunk_${document.id}`,
    canonical_identity: `chunk_${document.id}`,
    // Deliberately unrelated to Router's bodyVersion.
    canonical_version: 999,
    lifecycle_status: "active",
    relation: "direct",
    distance: 0,
    provider_rank: rank,
    fused_score: base / 1_000_000_000_000,
    base_score_picos: base,
    source_requested_weight_micros: 0,
    source_matched_weight_micros: 0,
    actor_requested_weight_micros: 0,
    actor_matched_weight_micros: 0,
    time_requested_weight_micros: 0,
    time_matched_weight_micros: 0,
    preference_score_micros: 0,
    preference_boost_micros: 0,
    rerank_score_picos: base,
    matched_query_ids: [queryId],
    contributions: ["postgres_keyword", "qdrant_dense"].map((providerId) => ({
      provider_id: providerId,
      query_id: queryId,
      provider_rank: rank,
      provider_weight_micros: 1_000_000,
      query_weight_micros: 1_000_000,
      contribution_score_picos: contribution,
      provider_weight: 1,
      query_weight: 1,
      contribution: contribution / 1_000_000_000_000,
      raw_score_kind: null,
      raw_score_value: null,
    })),
    neighbors: [],
  };
}

function respond(
  response: ServerResponse,
  status: number,
  value: unknown,
): void {
  if (response.destroyed) return;
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("fixture_expected_object");
  }
  return value as Record<string, unknown>;
}

function singleHeader(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const reconciliationCapability = {
  contract_version: "document-reconciliation.v1",
  endpoint: "/v1/documents/reconcile-exact",
  max_deadline_ms: 10_000,
  max_response_bytes: 65_536,
  visibility_evidence: ["accepted", "processing", "indexed"],
  read_only: true,
};

// Copied from the SDK's synthetic context_retrieval_v2/capability.json fixture.
const capability = {
  endpoint: "/v1/context/retrieve",
  contract_version: "context-retrieval.v2",
  ranking_policy: "weighted_rrf_canonical_preferences.v1",
  ranking_parameters: {
    rank_constant: 60,
    weight_scale_micros: 1_000_000,
    score_scale_picos: 1_000_000_000_000,
    preference_scale_micros: 1_000_000,
    max_preference_boost_micros: 250_000,
    contribution_rounding: "round_half_even",
    preference_rounding: "floor",
    canonical_signal_match_policy: "canonical_exact_key_interval_overlap.v1",
  },
  capability_fingerprint:
    "522cf13b82d20b8cf8f37b6e9fb3f4dc5752e24c9802c35b0f2fc30482083fae",
  profile_id: "locator-v2-pairs-relative-22222222",
  service_revision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  sdk_revision: "cccccccccccccccccccccccccccccccccccccccc",
  attribute_schema: "document-retrieval-projection.v1",
  index_profile_digest:
    "2222222222222222222222222222222222222222222222222222222222222222",
  coverage: "top_k_only",
  supports_neighbors: true,
  bounds: {
    query_variants: [1, 6],
    query_characters: [1, 512],
    provider_lanes: [1, 4],
    provider_rank: [1, 1_000],
    source_generations: [1, 100],
    candidate_limit: [1, 1_000],
    result_limit: [1, 50],
    neighbor_radius: [0, 2],
    response_byte_limit: [16_384, 1_048_576],
    deadline_ms: [1, 2_000],
    weight_micros: [100_000, 10_000_000],
  },
  hard_filter_signals: [
    "actor_keys",
    "category",
    "document_keys",
    "excluded_source_keys",
    "kinds",
    "relative_time_interval",
    "source_generations",
    "tags_all",
    "tags_any",
    "tags_none",
    "time_interval",
  ],
  soft_preference_signals: [
    "actor_preferences",
    "relative_time_interval",
    "source_preferences",
    "time_interval",
  ],
  required_provider_lanes: ["postgres_keyword", "qdrant_dense"],
  provider_lanes: [
    {
      provider_id: "postgres_keyword",
      required: true,
      healthy: true,
      weight_micros: 1_000_000,
      profile_qualified: true,
    },
    {
      provider_id: "qdrant_dense",
      required: true,
      healthy: true,
      weight_micros: 1_000_000,
      profile_qualified: true,
    },
  ],
};
