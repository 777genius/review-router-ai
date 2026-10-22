import type { MemoryScope } from "../../domain/memory-scope-policy";

export type MemorySearchCapability =
  | "lexical"
  | "full_text"
  | "semantic_vector"
  | "hybrid";

export type MemorySearchIndexCapabilities = {
  readonly capabilities: readonly MemorySearchCapability[];
};

export type MemorySearchIndexInput = {
  readonly workspaceId: string;
  readonly repositoryId: string;
  readonly userId: string | null;
  readonly safeQuery: string;
  readonly limit: number;
  readonly includeUserPrefs: boolean;
  readonly allowedScopes: readonly MemoryScope[];
};

/** One absolute deadline is shared by capability discovery and retrieval. */
export type MemorySearchRequestControls = {
  readonly deadlineAtMs: number;
  readonly signal?: AbortSignal;
};

export type MemorySearchIndexScoreParts = {
  readonly lexicalScore: number;
  readonly semanticScore: number;
  readonly recencyScore: number;
  readonly scopeScore: number;
  readonly riskPenalty: number;
};

/** Every hit certifies a queryable exact revision in this configured index. */
export type MemorySearchIndexResult = {
  readonly memoryItemId: string;
  readonly bodyVersion: number;
  readonly bodyHash: string;
  readonly score: number;
  readonly scope: MemoryScope;
  readonly scoreParts?: MemorySearchIndexScoreParts;
  readonly explanationCode: "lexical_match" | "semantic_match" | "fallback";
};

export type MemoryIndexDocument = {
  readonly workspaceId: string;
  readonly memoryItemId: string;
  readonly repositoryId: string | null;
  readonly userId: string | null;
  readonly scope: MemoryScope;
  readonly body: string;
  readonly bodyHash: string;
  readonly bodyVersion: number;
  readonly tags: readonly string[];
  readonly updatedAt: Date;
};

export type MemoryIndexWriteResult = {
  readonly status: "indexed" | "superseded";
};

export type MemoryIndexDeleteInput = {
  readonly workspaceId: string;
  readonly memoryItemId: string;
  readonly target:
    | { readonly kind: "item" }
    | {
        readonly kind: "revision";
        readonly bodyVersion: number;
        readonly bodyHash: string;
      };
};

export interface MemorySearchReaderPort {
  supports(
    controls?: MemorySearchRequestControls,
  ): Promise<MemorySearchIndexCapabilities>;
  search(
    input: MemorySearchIndexInput,
    controls?: MemorySearchRequestControls,
  ): Promise<readonly MemorySearchIndexResult[]>;
}

export interface MemorySearchWriterPort {
  /** Opaque deployment identity; backfill events must reach this same index. */
  readonly indexIdentity: string;
  /** Indexed means queryable; acceptance or an uncertain acknowledgement is insufficient. */
  upsertDocument(input: MemoryIndexDocument): Promise<MemoryIndexWriteResult>;
  /** Removes obsolete derived copies, never canonical memory. Unknown outcomes reject. */
  deleteDocument(input: MemoryIndexDeleteInput): Promise<void>;
}

export interface MemorySearchIndexPort
  extends MemorySearchReaderPort, MemorySearchWriterPort {}

/** Safe across outbox/log boundaries: never include a provider message or cause. */
export class MemoryIndexOperationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "MemoryIndexOperationError";
  }
}

const safeMemoryIndexErrorCodes: ReadonlySet<string> = new Set([
  "memory_index_pending",
  "memory_index_unavailable",
  "memory_index_conflict",
  "memory_index_unknown_write",
  "memory_index_identity_invalid",
  "memory_index_document_invalid",
  "memory_index_stale",
  "memory_index_incomplete",
  "memory_index_deadline",
]);

/** Never forward an arbitrary error code, message or cause across a boundary. */
export function safeMemoryIndexErrorCode(error: unknown): string | null {
  if (!(error instanceof MemoryIndexOperationError)) return null;
  const code = error.code;
  return safeMemoryIndexErrorCodes.has(code) ? code : null;
}
