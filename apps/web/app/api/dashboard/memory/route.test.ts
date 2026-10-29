import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryKnowledgeError } from "@reviewrouter/features-memory";
const server = vi.hoisted(() => ({
  load: vi.fn(),
  mutate: vi.fn(),
  progress: vi.fn(),
}));
vi.mock("../../../../src/server/dashboard-memory-knowledge", () => ({
  loadDashboardMemoryKnowledge: server.load,
  mutateDashboardMemoryKnowledge: server.mutate,
  readDashboardMemoryOperation: server.progress,
}));
vi.mock("../../../../src/server/codex-seed-script-url", () => ({
  resolveReviewRouterPublicWebUrl: () => "https://reviewrouter.dev",
}));
import { GET, POST } from "./route";
const input = {
  workspaceId: "workspace_1",
  repositoryId: null,
  action: "save",
  commandId: "123e4567-e89b-42d3-a456-426614174000",
  entryId: null,
  expectedRevision: null,
  body: "Use UTC timestamps.",
  topics: ["database"],
};
const post = (body: unknown, origin = "https://reviewrouter.dev") =>
  new Request("https://reviewrouter.dev/api/dashboard/memory", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  server.mutate.mockResolvedValue({ state: "queued" });
});
describe("memory browser API", () => {
  it("accepts only intent; actor, source, generation and approval are never browser authority", async () => {
    for (const extra of [
      { actor: { id: "admin" } },
      { source: { type: "manual" } },
      { generation: "g1" },
      { approval: { approvedAt: "now" } },
    ])
      expect((await POST(post({ ...input, ...extra }))).status).toBe(400);
    expect(server.mutate).not.toHaveBeenCalled();
    expect((await POST(post(input))).status).toBe(200);
    expect(server.mutate).toHaveBeenCalledExactlyOnceWith(input);
  });
  it("rejects cross-site JSON before composition and enforces actual byte bounds", async () => {
    expect((await POST(post(input, "https://evil.test"))).status).toBe(403);
    expect(
      (await POST(post({ ...input, body: "a".repeat(9_000) }))).status,
    ).toBe(413);
    expect(server.mutate).not.toHaveBeenCalled();
  });
  it("binds read and progress to explicit scope and disables shared caching", async () => {
    server.load.mockResolvedValue({ entries: [] });
    const list = await GET(
      new Request(
        "https://reviewrouter.dev/api/dashboard/memory?workspaceId=workspace_1&repositoryId=repo_1",
      ),
    );
    expect(server.load).toHaveBeenCalledExactlyOnceWith({
      workspaceId: "workspace_1",
      repositoryId: "repo_1",
    });
    expect(list.headers.get("cache-control")).toContain("no-store");
    await GET(
      new Request(
        `https://reviewrouter.dev/api/dashboard/memory?workspaceId=workspace_1&commandId=${input.commandId}`,
      ),
    );
    expect(server.progress).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace_1",
        repositoryId: null,
        commandId: input.commandId,
      }),
    );
  });
  it("does not expose provider text or treat failed authorization as an empty list", async () => {
    server.load.mockRejectedValueOnce(new MemoryKnowledgeError("forbidden"));
    expect(
      (
        await GET(
          new Request(
            "https://reviewrouter.dev/api/dashboard/memory?workspaceId=workspace_1",
          ),
        )
      ).status,
    ).toBe(403);
    server.mutate.mockRejectedValueOnce(
      new Error("secret provider endpoint and request body"),
    );
    const result = await POST(post(input));
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ error: "memory_unavailable" });
  });
  it("rejects duplicate query scope keys and arbitrary body authority", async () => {
    expect(
      (
        await GET(
          new Request(
            "https://reviewrouter.dev/api/dashboard/memory?workspaceId=workspace_1&workspaceId=workspace_2",
          ),
        )
      ).status,
    ).toBe(400);
    expect(server.load).not.toHaveBeenCalled();
  });
  it("passes a validated topic and native cursor through the scoped list boundary", async () => {
    server.load.mockResolvedValue({ entries: [] });
    expect(
      (
        await GET(
          new Request(
            "https://reviewrouter.dev/api/dashboard/memory?workspaceId=workspace_1&repositoryId=repo_1&topicId=database&cursor=native_page_2",
          ),
        )
      ).status,
    ).toBe(200);
    expect(server.load).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      repositoryId: "repo_1",
      topicId: "database",
      cursor: "native_page_2",
    });
    server.load.mockClear();
    expect(
      (
        await GET(
          new Request(
            "https://reviewrouter.dev/api/dashboard/memory?workspaceId=workspace_1&topicId=bad%20topic",
          ),
        )
      ).status,
    ).toBe(400);
    expect(server.load).not.toHaveBeenCalled();
  });
});
