/** Caller-owned authorization scope; never inferred from content or source IDs. */
export type MemoryScope = string;
export type RequestControls = {
  readonly deadlineAt: Date;
  readonly signal?: AbortSignal;
};
export type SourceRevision = {
  readonly id: string;
  readonly revision: string;
  readonly body: string;
};
export type SelectedStatement = {
  readonly body: string;
  readonly nativeType: "world" | "experience";
  readonly occurredAt?: string;
};
export type SourcePreviewResult =
  | {
      readonly status: "complete";
      readonly source: Pick<SourceRevision, "id" | "revision">;
      readonly statements: readonly SelectedStatement[];
    }
  | {
      readonly status: "unsupported" | "incomplete";
      readonly reason:
        | "unqualified"
        | "bounds"
        | "native_failure"
        | "deadline"
        | "invalid_result";
    };
export interface SourcePreviewPort {
  preview(
    input: {
      readonly scope: MemoryScope;
      readonly source: SourceRevision;
      readonly maxStatements: number;
      /** Complete transient context supplied by the host; it grants no mutation authority. */
      readonly readOnlyContext?: string;
    },
    controls: RequestControls,
  ): Promise<SourcePreviewResult>;
}

/** Stable writable source handles are separate from read-only derived observations. */
export type SourceRef = { readonly scope: MemoryScope; readonly id: string };
export type CurrentSource = {
  readonly ref: SourceRef;
  readonly body: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly tags: readonly string[];
};
export type NativeOperation = {
  readonly id: string;
  readonly state:
    | "pending"
    | "processing"
    | "completed"
    | "failed"
    | "cancelled"
    | "unknown";
  readonly kind: string | null;
  readonly children: readonly { readonly id: string; readonly state: string }[];
};
export interface CurrentSourceReader {
  readSource(
    ref: SourceRef,
    controls: RequestControls,
  ): Promise<CurrentSource | null>;
  listSources(
    input: {
      readonly scope: MemoryScope;
      readonly limit: number;
      readonly cursor?: string;
      readonly tags?: readonly string[];
    },
    controls: RequestControls,
  ): Promise<{
    readonly sources: readonly SourceRef[];
    readonly nextCursor: string | null;
  }>;
}
export interface ExactStatementWriter {
  /** Exact chunks only; application authority/revision CAS remain with the caller. */
  replaceSource(
    input: {
      readonly source: CurrentSource;
      readonly statementAt: string;
      readonly operationId: string;
      readonly derivationTags: readonly string[];
    },
    controls: RequestControls,
  ): Promise<{ readonly id: string; readonly state: "submitted" }>;
}
export interface MemoryOperationReader {
  operation(
    input: { readonly scope: MemoryScope; readonly id: string },
    controls: RequestControls,
  ): Promise<NativeOperation | null>;
}
export type RecalledEvidence = {
  readonly id: string;
  readonly body: string;
  readonly type: "source" | "observation";
  readonly sourceIds: readonly string[];
  readonly sourceFactIds: readonly string[];
  readonly evidenceComplete: boolean;
};
export interface MemoryRecallReader {
  recallEvidence(
    input: {
      readonly scope: MemoryScope;
      readonly query: string;
      readonly limit: number;
      readonly tags?: readonly string[];
    },
    controls: RequestControls,
  ): Promise<readonly RecalledEvidence[]>;
}
