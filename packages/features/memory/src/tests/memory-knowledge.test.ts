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
    findEntry: vi.fn(async () => metadata),
    scopeEpoch: vi.fn(async () => "1"),
    listEntries: vi.fn(async () => ({ entries: [metadata], nextCursor: null })),
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
});
