import type {
  MemoryEntryView,
  MemoryKnowledgePage,
} from "../../application/memory-knowledge-view";

export function memoryKnowledgePreviewData(
  repositoryId: string | null = null,
  topicId: string | null = null,
): MemoryKnowledgePage {
  const entry = (
    id: string,
    body: string,
    topics: string[],
    extra: Partial<MemoryEntryView> = {},
  ): MemoryEntryView => ({
    id,
    body,
    topics,
    revision: `revision_${id}`,
    kind: "rule",
    status: "active",
    sourceLabel: "GitHub discussion",
    sourceUrl: "https://github.com/acme/platform/pull/1287#issuecomment-123",
    statementAt: "2026-10-19T10:00:00.000Z",
    lastVerifiedAt: "2026-10-22T14:30:00.000Z",
    pendingCommandId: null,
    unavailable: null,
    ...extra,
  });
  return {
    workspaceId: "workspace_preview",
    repositoryId,
    topicId,
    repositories: [
      { id: "repo_platform", label: "acme/platform" },
      { id: "repo_dashboard", label: "acme/dashboard" },
    ],
    workspaceVisible: true,
    canManage: true,
    canExport: false,
    writesEnabled: true,
    availability: "ready",
    cursor: null,
    nextCursor: null,
    entries: [
      entry(
        "mem_queries",
        "Use parameterized queries for all database access. Keep SQL values separate from query text.",
        ["database", "security"],
      ),
      entry(
        "mem_tests",
        "Changes to payment calculations must include a regression test for rounding and currency conversion.",
        ["testing", "payments"],
        { sourceLabel: "Added in your workspace", sourceUrl: null },
      ),
      entry(
        "mem_observation",
        "The order worker retried failed deliveries every 30 seconds in the October release.",
        ["orders"],
        {
          kind: "observation",
          sourceLabel: "Learned from maintainer discussion",
          statementAt: "2026-10-08T09:15:00.000Z",
        },
      ),
      entry(
        "mem_logging",
        "Log structured JSON from production services.",
        ["observability"],
        { status: "retired" },
      ),
    ],
  };
}
