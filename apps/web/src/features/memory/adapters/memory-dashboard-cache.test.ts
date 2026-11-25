import { QueryClient } from "@tanstack/react-query";
import { expect, it } from "vitest";
import type { MemoryKnowledgePage } from "../application/memory-knowledge-view";
import { memoryKnowledgePreviewData } from "../interface/components/memory-knowledge-preview-data";
import { memoryPageKey } from "./memory-dashboard-api";
import { redactForgottenEntryAcrossCachedPages } from "./memory-dashboard-cache";

it("drains an already fulfilled old read before redacting, even when the next refresh fails", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const page = memoryKnowledgePreviewData();
  const key = memoryPageKey(page);
  const scopeKey = [
    "memory-knowledge",
    page.workspaceId,
    page.repositoryId,
  ] as const;
  const second = { ...page, cursor: "second-page" };
  const filtered = { ...page, topicId: "database" };
  const otherRepository = { ...page, repositoryId: "other-repository" };
  const otherWorkspace = { ...page, workspaceId: "other-workspace" };
  client.setQueryDefaults(scopeKey, {
    queryFn: async () => {
      throw new Error("Refresh unavailable");
    },
  });
  for (const cached of [
    page,
    second,
    filtered,
    otherRepository,
    otherWorkspace,
  ])
    client.setQueryData(memoryPageKey(cached), cached);
  let resolveRead!: (value: MemoryKnowledgePage) => void;
  const response = new Promise<MemoryKnowledgePage>((resolve) => {
    resolveRead = resolve;
  });
  let readCount = 0;
  try {
    const oldRead = client.fetchQuery({
      queryKey: key,
      staleTime: 0,
      queryFn: () => {
        if (++readCount === 1) return response;
        throw new Error("Refresh unavailable");
      },
    });
    const latePage = {
      ...page,
      entries: page.entries.map((entry) =>
        entry.id === "mem_queries"
          ? {
              ...entry,
              body: "Late approved body must never reappear.",
              topics: ["late-topic"],
            }
          : entry,
      ),
    };
    resolveRead(latePage);
    // The retryer has fulfilled, but Query.fetch's await continuation has not
    // committed its successful data yet. Cancelling alone cannot stop it now.
    await Promise.resolve();
    const query = client.getQueryCache().find({ queryKey: key })!;
    expect(
      (query.promise as Promise<MemoryKnowledgePage> & { status: string })
        .status,
    ).toBe("fulfilled");
    expect(query.state.fetchStatus).toBe("fetching");
    expect(
      client.getQueryData<MemoryKnowledgePage>(key)?.entries[0]?.body,
    ).toBe(page.entries[0]?.body);
    const redaction = redactForgottenEntryAcrossCachedPages(client, page, {
      id: "admitted-forget",
      entryId: "mem_queries",
      revision: "r2",
      state: "cleanup_pending",
      message: "Cleanup pending.",
    });
    await Promise.all([oldRead, redaction]);
    await expect(
      client.invalidateQueries(
        { queryKey: scopeKey, refetchType: "all" },
        { throwOnError: true },
      ),
    ).rejects.toThrow("Refresh unavailable");
    for (const cached of [page, second, filtered]) {
      const current = client.getQueryData<MemoryKnowledgePage>(
        memoryPageKey(cached),
      )!;
      expect(current.entries[0]).toMatchObject({
        body: null,
        topics: [],
        status: "forget_pending",
      });
      expect(current.entries[1]).toEqual(cached.entries[1]);
    }
    for (const cached of [otherRepository, otherWorkspace])
      expect(client.getQueryData(memoryPageKey(cached))).toEqual(cached);
    expect(readCount).toBe(2);
  } finally {
    client.clear();
  }
});
