"use client";
import { useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MemoryDashboardApi } from "../../adapters/memory-dashboard-api";
import type {
  MemoryEntryView,
  MemoryKnowledgePage,
  MemoryUnconfirmedChange,
} from "../../application/memory-knowledge-view";
import { MemoryKnowledgeScreen } from "./memory-knowledge-screen";

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
        { kind: "observation", statementAt: "2026-10-08T09:15:00.000Z" },
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
/** Environment-guarded fixture: the real screen, with no production mutation port. */
export function MemoryKnowledgePreview(): React.ReactElement {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  const [repositoryId, setRepositoryId] = useState<string | null>(null);
  const [topicId, setTopicId] = useState<string | null>(null);
  const [unconfirmedChange, setUnconfirmedChange] =
    useState<MemoryUnconfirmedChange | null>(null);
  const initialData = useMemo(() => {
    const page = memoryKnowledgePreviewData(repositoryId, topicId);
    return {
      ...page,
      entries: topicId
        ? page.entries.filter((entry) => entry.topics.includes(topicId))
        : page.entries,
    };
  }, [repositoryId, topicId]);
  const api = useMemo<MemoryDashboardApi>(() => {
    let page = initialData;
    return {
      async list() {
        return page;
      },
      async mutate(input) {
        const id =
          input.entryId ?? `mem_${input.commandId.replaceAll("-", "")}`;
        page = {
          ...page,
          entries:
            input.action === "save"
              ? [
                  {
                    id,
                    body: input.body,
                    topics: input.topics,
                    revision: "preview_revision",
                    kind: "rule",
                    status: "active",
                    sourceLabel: "Added in your workspace",
                    sourceUrl: null,
                    statementAt: new Date().toISOString(),
                    lastVerifiedAt: new Date().toISOString(),
                    pendingCommandId: null,
                    unavailable: null,
                  },
                  ...page.entries.filter((entry) => entry.id !== id),
                ]
              : page.entries.map((entry) =>
                  entry.id === id
                    ? {
                        ...entry,
                        status:
                          input.action === "retire" ? "retired" : "forgotten",
                        ...(input.action === "forget"
                          ? { body: null, topics: [] }
                          : {}),
                      }
                    : entry,
                ),
        };
        return {
          id: input.commandId,
          entryId: id,
          revision: "preview_revision",
          state: "queued",
          message: "Accepted. Waiting to process your change.",
        };
      },
      async progress(input) {
        return {
          id: input.commandId,
          entryId: "preview",
          revision: "preview_revision",
          state: "published",
          message: "Your change is published.",
        };
      },
    };
  }, [initialData]);
  return (
    <QueryClientProvider client={client}>
      <div className="mb-6 flex items-center gap-2 text-xs text-slate-500">
        <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" />
        Preview workspace · changes stay in this preview
      </div>
      <MemoryKnowledgeScreen
        key={`${repositoryId ?? "workspace"}:${topicId ?? "all"}`}
        initialData={initialData}
        api={api}
        onScopeChange={(id) => {
          setRepositoryId(id);
          setTopicId(null);
        }}
        onPageChange={() => {}}
        onTopicChange={setTopicId}
        unconfirmedChange={unconfirmedChange}
        onUnconfirmedChange={(change, commandId) =>
          setUnconfirmedChange(
            (current) =>
              change ??
              (current?.request.commandId === commandId ? null : current),
          )
        }
      />
    </QueryClientProvider>
  );
}
