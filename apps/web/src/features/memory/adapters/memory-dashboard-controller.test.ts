import { describe, expect, it, vi } from "vitest";
import { MemoryKnowledgeError } from "@reviewrouter/features-memory";
import type {
  MemoryKnowledgeAccessPort,
  MemoryKnowledgeService,
  MemoryKnowledgeStore,
} from "@reviewrouter/features-memory";
import { createMemoryDashboardController } from "./memory-dashboard-controller";
const commandId = "123e4567-e89b-42d3-a456-426614174000";
const actor = {
  kind: "workspace_user" as const,
  id: "user_real",
  githubUserId: null,
  login: null,
};
const selection = { workspaceId: "workspace_1", repositoryId: "repo_1" };
const ref = {
  type: "entry" as const,
  scope: { kind: "repository" as const, ...selection },
  entryId: "entry_1",
};
function fixture(
  options: {
    denied?: boolean;
    enabled?: boolean;
    mutationsEnabled?: boolean;
  } = {},
) {
  const access = {
    authorize: vi.fn(async () => {
      if (options.denied) throw new MemoryKnowledgeError("forbidden");
    }),
  };
  const service = {
    save: vi.fn(async (command) => ({
      id: command.commandId,
      ref: command.ref,
      revision: "revision_2",
      state: "queued",
    })),
    retire: vi.fn(async (command) => ({
      id: command.commandId,
      ref: command.ref,
      revision: "revision_2",
      state: "completed",
    })),
    forget: vi.fn(async (command) => ({
      id: command.commandId,
      ref: command.ref,
      revision: "revision_2",
      state: "cleanup_pending",
    })),
    list: vi.fn(async () => ({ entries: [], nextCursor: null })),
  };
  const store = {
    findCommand: vi.fn(async () => null),
    findEntry: vi.fn(async () => ({
      kind: "rule",
      applicability: {
        validUntil: null,
        observedCommitSha: null,
        exceptionRule: null,
      },
    })),
  };
  let at = new Date("2026-10-23T10:00:00Z");
  return {
    service,
    access,
    store,
    advance() {
      at = new Date(at.getTime() + 60_000);
    },
    controller: createMemoryDashboardController({
      service: service as unknown as MemoryKnowledgeService,
      access: access as unknown as MemoryKnowledgeAccessPort,
      store: store as unknown as MemoryKnowledgeStore,
      actor,
      generation: "generation_1",
      providerProfileVersion: "profile_1",
      enabled: options.enabled ?? true,
      mutationsEnabled: options.mutationsEnabled ?? true,
      now: () => at,
    }),
  };
}
describe("dashboard memory command boundary", () => {
  it("builds source authority on the server, keeps approval time and exact envelope on retry", async () => {
    const f = fixture();
    const input = {
      ...selection,
      action: "save" as const,
      commandId,
      entryId: null,
      expectedRevision: null,
      body: "Use parameterized SQL.",
      topics: ["database"],
    };
    expect((await f.controller.mutate(input)).state).toBe("queued");
    const first = f.service.save.mock.calls[0]![0];
    expect(first.approval.actor).toEqual(actor);
    expect(first.source).toMatchObject({
      type: "manual",
      sourceId: `manual:${commandId}`,
      updatedAt: "2026-10-23T10:00:00.000Z",
      statementAt: "2026-10-23T10:00:00.000Z",
      url: null,
    });
    f.store.findCommand.mockResolvedValueOnce({
      approval: first.approval,
    } as never);
    f.advance();
    await f.controller.mutate(input);
    expect(f.service.save.mock.calls[1]![0]).toEqual(first);
  });
  it("preserves expected revision and existing knowledge kind on a correction", async () => {
    const f = fixture();
    f.store.findEntry.mockResolvedValueOnce({
      kind: "observation",
      applicability: {
        validUntil: null,
        observedCommitSha: "a".repeat(40),
        exceptionRule: null,
      },
    } as never);
    await f.controller.mutate({
      ...selection,
      action: "save",
      commandId,
      entryId: ref.entryId,
      expectedRevision: "revision_1",
      body: "Earlier worker behavior.",
      topics: [],
    });
    expect(f.service.save.mock.calls[0]![0]).toMatchObject({
      expectedRevision: "revision_1",
      knowledgeKind: "observation",
      applicability: { observedCommitSha: "a".repeat(40) },
      temporalMode: "preserve_original",
    });
  });
  it("denies viewers and never calls the provider-facing service for mutation", async () => {
    const f = fixture({ denied: true });
    await expect(
      f.controller.mutate({
        ...selection,
        action: "forget",
        commandId,
        entryId: ref.entryId,
        expectedRevision: "r1",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(f.service.forget).not.toHaveBeenCalled();
  });
  it("allows removal while memory saving is disabled and reports pending cleanup honestly", async () => {
    const f = fixture({ enabled: false });
    const result = await f.controller.mutate({
      ...selection,
      action: "forget",
      commandId,
      entryId: ref.entryId,
      expectedRevision: "r1",
    });
    expect(result.state).toBe("cleanup_pending");
    expect(result.message).toMatch(/cleanup is still pending/);
    await f.controller.mutate({
      ...selection,
      action: "retire",
      commandId,
      entryId: ref.entryId,
      expectedRevision: "r1",
    });
    expect(f.service.retire).toHaveBeenCalledOnce();
  });
  it("rejects missing CAS and another actor's retry before delivering a command", async () => {
    const f = fixture();
    await expect(
      f.controller.mutate({
        ...selection,
        action: "forget",
        commandId,
        entryId: ref.entryId,
        expectedRevision: null,
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    f.store.findCommand.mockResolvedValueOnce({
      approval: { actor: { ...actor, id: "different_user" } },
    } as never);
    await expect(
      f.controller.mutate({
        ...selection,
        action: "forget",
        commandId,
        entryId: ref.entryId,
        expectedRevision: "r1",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(f.service.forget).not.toHaveBeenCalled();
  });
  it("passes topic pagination to the authorized knowledge service", async () => {
    const f = fixture();
    const result = await f.controller.list(
      { ...selection, topicId: "database", cursor: "native_page_2" },
      { repositories: [], workspaceVisible: true, writesEnabled: true },
    );
    expect(f.service.list).toHaveBeenCalledWith(
      {
        actor,
        scope: ref.scope,
        limit: 30,
        topicId: "database",
        cursor: "native_page_2",
      },
      expect.anything(),
    );
    expect(result.topicId).toBe("database");
    expect(result.cursor).toBe("native_page_2");
  });
});
