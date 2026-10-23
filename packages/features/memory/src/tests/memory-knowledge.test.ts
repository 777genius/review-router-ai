import { describe, expect, it, vi } from "vitest";
import { createMemoryBodyHash } from "../domain/memory-body";
import {
  memoryKnowledgeBodyVisible,
  memoryKnowledgeCommandDigest,
  memoryKnowledgeTopicsDigest,
  normalizeMemoryKnowledgeCommand,
  type MemoryKnowledgeCommand,
  type MemoryKnowledgeEntryMetadata,
  type MemoryKnowledgeScope,
} from "../domain/memory-knowledge";
import { MemoryKnowledgeService } from "../application/use-cases/memory-knowledge-service";
import type {
  MemoryProviderEntry,
  MemoryProviderRecallItem,
  MemoryRequestControls,
} from "../application/ports/memory-knowledge-provider-port";

const now = new Date("2026-10-23T10:00:00.000Z");
const scope: MemoryKnowledgeScope = {
  kind: "repository",
  workspaceId: "workspace",
  repositoryId: "repository",
};
const actor = {
  kind: "workspace_user" as const,
  id: "user",
  githubUserId: null,
  login: null,
};
const command: Extract<MemoryKnowledgeCommand, { kind: "save" }> = {
  kind: "save",
  ref: { type: "entry", scope, entryId: "mem_entry" },
  commandId: "11111111-1111-4111-8111-111111111111",
  expectedRevision: null,
  generation: "generation",
  providerProfileVersion: "profile",
  approval: {
    actor,
    approvedAt: now.toISOString(),
    authorityRevision: "member-1",
  },
  body: "Use bounded requests.",
  knowledgeKind: "rule",
  topicIds: ["requests"],
  source: {
    type: "manual",
    sourceId: "decision",
    revision: "1",
    updatedAt: now.toISOString(),
    statementAt: now.toISOString(),
    repositoryId: null,
    pullRequestNumber: null,
    url: null,
    visibility: "internal",
    claimedBodyDigest: null,
    observedCommitSha: null,
  },
  applicability: {
    validUntil: null,
    observedCommitSha: null,
    exceptionRule: null,
  },
  temporalMode: "preserve_original",
};

const metadata: MemoryKnowledgeEntryMetadata = {
  ref: command.ref,
  generation: command.generation,
  revision: "1",
  contentApprovalRevision: "1",
  bodyDigest: createMemoryBodyHash(command.body),
  topicsDigest: memoryKnowledgeTopicsDigest(command.topicIds),
  kind: "rule",
  lifecycle: "active",
  approval: command.approval,
  source: command.source,
  applicability: command.applicability,
  originalStatementAt: now.toISOString(),
  lastVerifiedAt: now.toISOString(),
  pendingCommandId: null,
  revocationCommandId: null,
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
};
const entry: MemoryProviderEntry = {
  ref: command.ref,
  body: command.body,
  bodyDigest: metadata.bodyDigest!,
  contentApprovalRevision: "1",
  kind: "rule",
  topicIds: command.topicIds,
  statementAt: now.toISOString(),
  sourceFactIds: ["fact"],
};
const controls = { deadlineAt: new Date(now.getTime() + 10_000) };

function fixture() {
  const store = {
    maintenanceState: vi.fn(async () => ({
      generation: "generation",
      epoch: "0",
      paused: false,
    })),
    findEntry: vi.fn(async () => metadata),
    scopeEpoch: vi.fn(async () => "1"),
    listEntries: vi.fn(async () => ({ entries: [metadata], nextCursor: null })),
    listExpiredEntries: vi.fn(async () => [metadata]),
    admit: vi.fn(async () => ({
      id: command.commandId,
      ref: command.ref,
      revision: "1",
      state: "queued" as const,
    })),
  };
  const reader = {
    read: vi.fn(async () => entry),
    list: vi.fn(),
    recall: vi.fn(
      async (
        _input: unknown,
        _controls: MemoryRequestControls,
      ): Promise<readonly MemoryProviderRecallItem[]> => [
        { type: "entry", entry },
      ],
    ),
  };
  const access = {
    authorize: vi.fn(async () => {}),
    verifySource: vi.fn(async () => command.source),
    sourceApplicable: vi.fn(async () => true),
  };
  const policy = {
    getPolicy: vi.fn(async () => ({
      memoryEnabled: true,
      allowedScopes: { workspace: true, repository: true, user_prefs: true },
    })),
  };
  const service = new MemoryKnowledgeService({
    generation: "generation",
    providerProfileVersion: "profile",
    store: store as never,
    reader,
    writer: {} as never,
    observer: {} as never,
    access,
    policy: policy as never,
    quota: {
      getWorkspaceQuota: async () => ({
        activeItems: { limit: 10 },
        pendingSuggestions: { limit: 10 },
      }),
    },
    now: () => now,
  });
  return { store, reader, access, policy, service };
}

describe("complete provider memory policy", () => {
  it("automatically expires only due entries with deterministic revision-bound commands and no human grant", async () => {
    const { service, store, access } = fixture();
    const due = {
      ...metadata,
      applicability: {
        ...metadata.applicability,
        validUntil: now.toISOString(),
      },
    };
    store.listExpiredEntries.mockResolvedValue([
      due,
      metadata,
      { ...due, lifecycle: "retired" },
      {
        ...due,
        applicability: {
          ...due.applicability,
          validUntil: new Date(now.getTime() + 1000).toISOString(),
        },
      },
    ]);
    expect(await service.expireDueEntries()).toBe(1);
    expect(await service.expireDueEntries()).toBe(1);
    expect(store.admit.mock.calls).toHaveLength(2);
    const first = (
      store.admit.mock.calls as unknown as [
        { command: MemoryKnowledgeCommand },
      ][]
    )[0]![0].command;
    const second = (
      store.admit.mock.calls as unknown as [
        { command: MemoryKnowledgeCommand },
      ][]
    )[1]![0].command;
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      kind: "expire",
      expectedRevision: "1",
      approval: {
        actor: { kind: "system", id: "memory-expiry-worker" },
        approvedAt: now.toISOString(),
      },
    });
    expect(access.authorize).not.toHaveBeenCalled();
  });
  it("binds the full normalized approved command rather than only body text", () => {
    const digest = memoryKnowledgeCommandDigest(command);
    expect(
      memoryKnowledgeCommandDigest({
        ...command,
        body: " Use  bounded requests.\n",
      }),
    ).toBe(digest);
    expect(
      memoryKnowledgeCommandDigest({ ...command, topicIds: ["other"] }),
    ).not.toBe(digest);
    expect(
      memoryKnowledgeCommandDigest({
        ...command,
        source: { ...command.source, revision: "2" },
      }),
    ).not.toBe(digest);
    expect(
      memoryKnowledgeCommandDigest({
        ...command,
        applicability: {
          ...command.applicability,
          validUntil: "2027-01-01T00:00:00Z",
        },
      }),
    ).not.toBe(digest);
    expect(
      memoryKnowledgeCommandDigest({
        ...command,
        approval: { ...command.approval, authorityRevision: "member-2" },
      }),
    ).not.toBe(digest);
  });

  it("rejects unknown/raw fields at every persisted command boundary", () => {
    expect(() =>
      normalizeMemoryKnowledgeCommand({
        ...command,
        rawThread: "raw source",
      } as never),
    ).toThrow("memory_invalid_input");
    expect(() =>
      normalizeMemoryKnowledgeCommand({
        ...command,
        source: { ...command.source, redactedExcerpt: "raw source" },
      } as never),
    ).toThrow("memory_invalid_input");
    expect(() =>
      normalizeMemoryKnowledgeCommand({
        ...command,
        ref: { ...command.ref, type: "observation" },
      } as never),
    ).toThrow("memory_invalid_input");
    expect(() =>
      normalizeMemoryKnowledgeCommand({
        ...command,
        temporalMode: "retime",
      } as never),
    ).toThrow("memory_unsupported");
  });

  it("rejects missing approval or actor as invalid input before dereferencing", () => {
    for (const approval of [undefined, null, {}, { actor: null }]) {
      expect(() =>
        normalizeMemoryKnowledgeCommand({ ...command, approval } as never),
      ).toThrow("memory_invalid_input");
    }
  });

  it("keeps retained inactive management bodies eligible and fences every forgotten/unsettled body", () => {
    for (const lifecycle of ["retired", "expired"] as const) {
      expect(
        memoryKnowledgeBodyVisible({ ...metadata, lifecycle }, "runtime", now),
      ).toBe(false);
      expect(
        memoryKnowledgeBodyVisible(
          { ...metadata, lifecycle },
          "management",
          now,
        ),
      ).toBe(true);
      expect(
        memoryKnowledgeBodyVisible({ ...metadata, lifecycle }, "export", now),
      ).toBe(true);
    }
    for (const state of [
      { lifecycle: "forget_pending" as const },
      { lifecycle: "forgotten" as const },
      { pendingCommandId: "unknown" },
      { revocationCommandId: "urgent" },
    ])
      for (const consumer of ["runtime", "management", "export"] as const)
        expect(
          memoryKnowledgeBodyVisible({ ...metadata, ...state }, consumer, now),
        ).toBe(false);
  });

  it("never pairs an old native body or approval with newer product metadata", async () => {
    const { service, reader } = fixture();
    reader.read.mockResolvedValueOnce({ ...entry, body: "Old body." });
    await expect(
      service.read({ actor, ref: command.ref }, controls),
    ).resolves.toMatchObject({
      body: null,
      unavailableReason: "incomplete_evidence",
    });
    reader.read.mockResolvedValueOnce({
      ...entry,
      contentApprovalRevision: "0",
    });
    await expect(
      service.read({ actor, ref: command.ref }, controls),
    ).resolves.toMatchObject({
      body: null,
      unavailableReason: "incomplete_evidence",
    });
  });

  it("permits settled retained export while memory is disabled and reports unsettled omissions", async () => {
    const { service, store, policy } = fixture();
    policy.getPolicy.mockResolvedValue({
      memoryEnabled: false,
      allowedScopes: { workspace: true, repository: true, user_prefs: true },
    });
    store.listEntries.mockResolvedValueOnce({
      entries: [{ ...metadata, lifecycle: "retired" }],
      nextCursor: null,
    });
    await expect(
      service.export({ actor, scope }, controls),
    ).resolves.toMatchObject({
      format: "memory-core-export/v1",
      entries: [{ body: command.body }],
      omitted: [],
    });
    store.listEntries.mockResolvedValueOnce({
      entries: [{ ...metadata, lifecycle: "forget_pending" }],
      nextCursor: null,
    });
    await expect(
      service.export({ actor, scope }, controls),
    ).resolves.toMatchObject({
      entries: [],
      omitted: [{ entryId: command.ref.entryId, reason: "unsettled" }],
    });
  });

  it("discards a whole bundle when its final eligibility epoch changes", async () => {
    const { service, store } = fixture();
    store.scopeEpoch.mockResolvedValueOnce("1").mockResolvedValueOnce("2");
    await expect(
      service.bundle({ actor, scopes: [scope], query: "requests" }, controls),
    ).resolves.toMatchObject({ scopes: [], degraded: true });
  });

  it("returns a memory-free review by the total deadline even when metadata I/O stalls", async () => {
    const { service, store, reader } = fixture();
    store.scopeEpoch.mockImplementationOnce(
      () => new Promise<string>(() => {}),
    );
    const result = await service.bundle(
      { actor, scopes: [scope], query: "requests" },
      { deadlineAt: new Date(now.getTime() + 20) },
    );
    expect(result).toMatchObject({ degraded: true, scopes: [] });
    expect(reader.recall).not.toHaveBeenCalled();
  });

  it("validates every observation source and omits truncated or cross-scope evidence", async () => {
    const { service, reader } = fixture();
    const observation = {
      type: "observation" as const,
      ref: { type: "observation" as const, scope, observationId: "derived" },
      body: "Historical requests.",
      sourceEntries: [command.ref],
      evidenceComplete: false,
      temporalStatus: "historical" as const,
    };
    reader.recall.mockResolvedValueOnce([observation]);
    expect(
      (
        await service.bundle(
          { actor, scopes: [scope], query: "requests" },
          controls,
        )
      ).scopes[0]?.items,
    ).toEqual([]);
    reader.recall.mockResolvedValueOnce([
      {
        ...observation,
        evidenceComplete: true,
        sourceEntries: [
          command.ref,
          { ...command.ref, scope: { ...scope, workspaceId: "other" } },
        ],
      },
    ]);
    expect(
      (
        await service.bundle(
          { actor, scopes: [scope], query: "requests" },
          controls,
        )
      ).scopes[0]?.items,
    ).toEqual([]);
  });

  it("uses one total two-second deadline across both scopes and drops revoked immutable snapshots", async () => {
    const { service, reader, store } = fixture();
    const bundle = await service.bundle(
      {
        actor,
        scopes: [scope, { kind: "workspace", workspaceId: "workspace" }],
        query: "requests",
      },
      controls,
    );
    for (const call of reader.recall.mock.calls)
      expect(call[1].deadlineAt.getTime()).toBe(now.getTime() + 2_000);
    store.scopeEpoch.mockResolvedValue("2");
    expect(await service.admitBundle({ actor, bundle }, controls)).toBe(false);
  });

  it("admits a metadata-only frozen receipt without refetching provider bodies and rechecks source access", async () => {
    const { service, reader, access } = fixture();
    const bundle = await service.bundle(
      { actor, scopes: [scope], query: "requests" },
      controls,
    );
    const receipt = service.createBundleReceipt(bundle);
    expect(JSON.stringify(receipt)).not.toContain(command.body);
    expect(receipt.scopes[0]?.entries).toEqual([
      { ref: command.ref, revision: "1", contentApprovalRevision: "1" },
    ]);
    reader.read.mockClear();
    reader.recall.mockClear();
    expect(await service.admitReceipt({ actor, receipt }, controls)).toBe(true);
    expect(reader.read).not.toHaveBeenCalled();
    expect(reader.recall).not.toHaveBeenCalled();
    access.sourceApplicable.mockResolvedValueOnce(false);
    expect(await service.admitReceipt({ actor, receipt }, controls)).toBe(
      false,
    );
  });

  it("rechecks repository-specific scope policy during receipt admission", async () => {
    const { service, policy } = fixture();
    const bundle = await service.bundle(
      { actor, scopes: [scope], query: "requests" },
      controls,
    );
    policy.getPolicy.mockResolvedValueOnce({
      memoryEnabled: true,
      allowedScopes: { workspace: true, repository: false, user_prefs: true },
    });
    expect(
      await service.admitReceipt(
        { actor, receipt: service.createBundleReceipt(bundle) },
        controls,
      ),
    ).toBe(false);
    expect(policy.getPolicy).toHaveBeenLastCalledWith({
      workspaceId: scope.workspaceId,
      repositoryId: scope.repositoryId,
    });
  });

  it("rejects an exception whose exact authorized shared target is not an active rule", async () => {
    const { service, store } = fixture();
    const target = {
      type: "entry" as const,
      scope: { kind: "workspace" as const, workspaceId: scope.workspaceId },
      entryId: "shared_rule",
    };
    store.findEntry.mockResolvedValueOnce({
      ...metadata,
      ref: target,
      kind: "observation",
    });
    await expect(
      service.save(
        {
          ...command,
          knowledgeKind: "exception",
          applicability: { ...command.applicability, exceptionRule: target },
        },
        controls,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(store.admit).not.toHaveBeenCalled();
  });
});
