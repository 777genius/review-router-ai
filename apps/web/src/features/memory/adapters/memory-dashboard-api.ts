import type {
  MemoryDashboardMutation,
  MemoryKnowledgePage,
  MemoryOperationView,
  MemoryScopeSelection,
} from "../application/memory-knowledge-view";

export interface MemoryDashboardApi {
  list(
    input: MemoryScopeSelection & {
      readonly cursor?: string | null;
      readonly topicId?: string | null;
    },
    signal?: AbortSignal,
  ): Promise<MemoryKnowledgePage>;
  mutate(input: MemoryDashboardMutation): Promise<MemoryOperationView>;
  progress(
    input: MemoryScopeSelection & { readonly commandId: string },
    signal?: AbortSignal,
  ): Promise<MemoryOperationView>;
}
export class MemoryDashboardApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(
      code === "memory_conflict"
        ? "This memory changed. Refresh the list before editing again."
        : code === "memory_forbidden"
          ? "You do not have permission to make this change."
          : code === "memory_invalid_input"
            ? "Check the memory text and topics, then try again."
            : "Memory is temporarily unavailable. Your request can be retried safely.",
    );
    this.name = "MemoryDashboardApiError";
  }
}
export const memoryPageKey = (
  input: MemoryScopeSelection & {
    readonly cursor?: string | null;
    readonly topicId?: string | null;
  },
) =>
  [
    "memory-knowledge",
    input.workspaceId,
    input.repositoryId,
    input.cursor ?? null,
    input.topicId ?? null,
  ] as const;
export const memoryOperationKey = (
  input: MemoryScopeSelection,
  commandId: string | null,
) =>
  [
    "memory-operation",
    input.workspaceId,
    input.repositoryId,
    commandId,
  ] as const;
export function memoryQuery(
  input: MemoryScopeSelection & {
    readonly cursor?: string | null;
    readonly commandId?: string;
    readonly topicId?: string | null;
  },
): string {
  const query = new URLSearchParams({ workspaceId: input.workspaceId });
  if (input.repositoryId) query.set("repositoryId", input.repositoryId);
  if (input.cursor) query.set("cursor", input.cursor);
  if (input.commandId) query.set("commandId", input.commandId);
  if (input.topicId) query.set("topicId", input.topicId);
  return query.toString();
}
async function read<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as {
      error?: unknown;
    } | null;
    const code =
      typeof data?.error === "string" && /^memory_[a-z_]+$/.test(data.error)
        ? data.error
        : "memory_unavailable";
    throw new MemoryDashboardApiError(code, response.status);
  }
  return response.json() as Promise<T>;
}
export function createMemoryDashboardApi(endpoint: string): MemoryDashboardApi {
  return {
    async list(input, signal) {
      return read<MemoryKnowledgePage>(
        await fetch(`${endpoint}?${memoryQuery(input)}`, {
          cache: "no-store",
          ...(signal ? { signal } : {}),
        }),
      );
    },
    async progress(input, signal) {
      return read<MemoryOperationView>(
        await fetch(`${endpoint}?${memoryQuery(input)}`, {
          cache: "no-store",
          ...(signal ? { signal } : {}),
        }),
      );
    },
    async mutate(input) {
      return read<MemoryOperationView>(
        await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }),
      );
    },
  };
}
export const memoryDashboardApi = createMemoryDashboardApi(
  "/api/dashboard/memory",
);
export function memoryExportHref(input: MemoryScopeSelection): string {
  return `/api/dashboard/memory/export?${memoryQuery(input)}`;
}
