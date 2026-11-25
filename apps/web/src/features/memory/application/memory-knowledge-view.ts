/** Browser-facing product state. Provider credentials and operational identities never enter this contract. */
export type MemoryScopeSelection = {
  readonly workspaceId: string;
  readonly repositoryId: string | null;
};
export type MemoryEntryView = {
  readonly id: string;
  readonly revision: string;
  readonly kind: "rule" | "exception" | "observation";
  readonly status:
    | "active"
    | "retired"
    | "expired"
    | "forget_pending"
    | "forgotten";
  readonly body: string | null;
  readonly topics: readonly string[];
  readonly sourceLabel: string;
  readonly sourceUrl: string | null;
  readonly statementAt: string | null;
  readonly lastVerifiedAt: string | null;
  readonly pendingCommandId: string | null;
  readonly unavailable:
    | "unsettled"
    | "provider_unavailable"
    | "incomplete_evidence"
    | null;
};
export type MemoryOperationView = {
  readonly id: string;
  readonly entryId: string;
  readonly revision: string;
  readonly state:
    | "queued"
    | "submitted"
    | "processing"
    | "published"
    | "failed"
    | "unknown"
    | "cleanup_pending"
    | "completed";
  readonly message: string;
};
export type MemoryKnowledgePage = MemoryScopeSelection & {
  readonly topicId: string | null;
  readonly repositories: readonly {
    readonly id: string;
    readonly label: string;
  }[];
  readonly workspaceVisible: boolean;
  readonly entries: readonly MemoryEntryView[];
  readonly nextCursor: string | null;
  readonly cursor: string | null;
  readonly canManage: boolean;
  readonly canExport: boolean;
  readonly writesEnabled: boolean;
  readonly availability: "ready" | "disabled" | "unavailable";
};
export type MemoryDashboardMutation = MemoryScopeSelection & {
  readonly commandId: string;
  readonly entryId: string | null;
  readonly expectedRevision: string | null;
} & (
    | {
        readonly action: "save";
        readonly body: string;
        readonly topics: readonly string[];
      }
    | { readonly action: "retire" | "forget" }
  );
/** One exact approval awaiting a confirmed response, kept only in the current workspace UI. */
export type MemoryUnconfirmedChange = {
  readonly request: MemoryDashboardMutation;
  readonly entry: MemoryEntryView | null;
};
export function memoryOperationMessage(
  state: MemoryOperationView["state"],
): string {
  switch (state) {
    case "queued":
      return "Accepted. Waiting to process your change.";
    case "submitted":
    case "processing":
      return "Your change is processing. It is not available to new reviews yet.";
    case "published":
      return "Your change is published.";
    case "completed":
      return "Your change is complete.";
    case "cleanup_pending":
      return "Removed from new reviews. Stored-copy cleanup is still pending.";
    case "unknown":
      return "We are checking the outcome. Retry uses the same request.";
    case "failed":
      return "The change could not be completed. Review its status before trying again.";
  }
}
