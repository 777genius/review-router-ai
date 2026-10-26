"use client";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryDashboardApi,
  type MemoryDashboardApi,
} from "../../adapters/memory-dashboard-api";
import { memoryKnowledgePreviewData } from "./memory-knowledge-preview-data";
export { memoryKnowledgePreviewData } from "./memory-knowledge-preview-data";
import type { MemoryUnconfirmedChange } from "../../application/memory-knowledge-view";
import { MemoryKnowledgeScreen } from "./memory-knowledge-screen";

/** Environment-guarded fixture: the real screen, with no production mutation port. */
export function MemoryKnowledgePreview(): React.ReactElement {
  const httpFixture = useSearchParams().get("fixture") === "http";
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
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
    // This endpoint deliberately has no server route. Only the browser test harness intercepts it.
    if (httpFixture)
      return createMemoryDashboardApi("/api/memory-preview-fixture");
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
  }, [initialData, httpFixture]);
  return (
    <QueryClientProvider client={client}>
      <div
        data-memory-preview-ready={ready}
        className="mb-6 flex items-center gap-2 text-xs text-slate-500"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" />
        {httpFixture
          ? "UI-only API fixture · synthetic changes stay in this test"
          : "Preview workspace · changes stay in this preview"}
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
