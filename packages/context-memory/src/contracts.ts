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
      readonly readOnlyContext: string;
      readonly maxStatements: number;
    },
    controls: RequestControls,
  ): Promise<SourcePreviewResult>;
}
