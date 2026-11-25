import type { QueryClient } from "@tanstack/react-query";
import type {
  MemoryScopeSelection,
  MemoryKnowledgePage,
  MemoryEntryView,
  MemoryOperationView,
} from "../application/memory-knowledge-view";

/** A confirmed removal must outlive a failed refresh of any cached scope page. */
export async function redactForgottenEntryAcrossCachedPages(
  client: QueryClient,
  selection: MemoryScopeSelection,
  operation: MemoryOperationView,
): Promise<void> {
  const queryKey = [
    "memory-knowledge",
    selection.workspaceId,
    selection.repositoryId,
  ] as const;
  // A fulfilled retryer may still have a queued Query.fetch continuation.
  // Drain it before writing the visibility fence, even if cancellation is a no-op.
  await client.cancelQueries({ queryKey });
  client.setQueriesData<MemoryKnowledgePage>({ queryKey }, (page) => {
    if (
      !page ||
      page.workspaceId !== selection.workspaceId ||
      page.repositoryId !== selection.repositoryId
    )
      return page;
    return {
      ...page,
      entries: page.entries.map(
        (entry): MemoryEntryView =>
          entry.id === operation.entryId
            ? {
                ...entry,
                body: null,
                topics: [],
                status:
                  operation.state === "completed"
                    ? "forgotten"
                    : "forget_pending",
                pendingCommandId:
                  operation.state === "completed" ? null : operation.id,
                unavailable: "unsettled",
              }
            : entry,
      ),
    };
  });
}
