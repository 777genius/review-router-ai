import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  MemoryKnowledgeService,
  createMemoryBodyHash,
  defaultMemoryPolicyConfig,
  memoryKnowledgeScopeKey,
  memoryKnowledgeTopicsDigest,
  type MemoryKnowledgeEntryMetadata,
  type MemoryKnowledgeReader,
  type MemoryProviderEntry,
} from "../../../packages/features/memory/src/index.js";
import { PrismaMemoryAutomaticSourceStore } from "../../../packages/features/memory/src/infrastructure/prisma/prisma-memory-automatic-source-store.js";
import { PrismaMemoryKnowledgeStore } from "../../../packages/features/memory/src/infrastructure/index.js";
import type { MemoryKnowledgeRuntime } from "../../../packages/features/memory/src/composition/index.js";
import { UnlimitedMemoryQuotaPolicy } from "../../../packages/features/memory/src/application/ports/memory-quota-policy-port.js";

export const audienceMemoryStatements = Object.freeze([
  {
    scope: "workspace" as const,
    visibility: "private" as const,
    body: "Internal workspace convention: invoice ownership uses the billing tenant identity.",
  },
  {
    scope: "repository" as const,
    visibility: "private" as const,
    body: "Private source decision: invoice exports retain the internal reconciliation key.",
  },
  {
    scope: "repository" as const,
    visibility: "public" as const,
    body: "Public project terminology: an invoice owner is the account receiving the invoice.",
  },
]);

/** Approved metadata + deterministic provider reader; no learning/native claim. */
export async function createApprovedMemoryFixture(input: {
  prisma: PrismaClient;
  workspaceId: string;
  repositoryId: string;
  generation: string;
  statements?: readonly Readonly<{
    scope: "workspace" | "repository";
    visibility: "public" | "private";
    body: string;
  }>[];
}) {
  const workspace = {
    kind: "workspace" as const,
    workspaceId: input.workspaceId,
  };
  const repository = {
    kind: "repository" as const,
    workspaceId: input.workspaceId,
    repositoryId: input.repositoryId,
  };
  const now = new Date().toISOString();
  const approval = {
    actor: {
      kind: "workspace_user" as const,
      id: "synthetic-approved-owner",
      githubUserId: null,
      login: null,
    },
    approvedAt: now,
    authorityRevision: "synthetic-owner-approval-v1",
  };
  const entries = (
    input.statements ?? [
      {
        scope: "repository",
        visibility: "private",
        body: "Use UTC for persisted event timestamps. Публичный контракт времени.",
      },
    ]
  ).map((statement) => {
    const ref = {
      type: "entry" as const,
      scope: statement.scope === "workspace" ? workspace : repository,
      entryId: `mem_${randomUUID().replaceAll("-", "")}`,
    };
    const metadata: MemoryKnowledgeEntryMetadata = {
      ref,
      generation: input.generation,
      revision: "1",
      contentApprovalRevision: "1",
      bodyDigest: createMemoryBodyHash(statement.body),
      topicsDigest: memoryKnowledgeTopicsDigest([]),
      kind: "rule",
      lifecycle: "active",
      approval,
      source: {
        type: "manual",
        sourceId: `synthetic-approved-${ref.entryId}`,
        revision: "1",
        updatedAt: now,
        statementAt: now,
        repositoryId:
          statement.scope === "repository" ? input.repositoryId : null,
        pullRequestNumber: null,
        url: null,
        visibility: statement.visibility,
        claimedBodyDigest: null,
        observedCommitSha: null,
      },
      applicability: {
        validUntil: null,
        observedCommitSha: null,
        exceptionRule: null,
      },
      originalStatementAt: now,
      lastVerifiedAt: now,
      pendingCommandId: null,
      revocationCommandId: null,
      createdAt: now,
      updatedAt: now,
    };
    const entry: MemoryProviderEntry = {
      ref,
      body: statement.body,
      bodyDigest: metadata.bodyDigest!,
      contentApprovalRevision: "1",
      kind: "rule",
      topicIds: [],
      statementAt: now,
      sourceFactIds: [`synthetic-native-${ref.entryId}`],
    };
    return { ...entry, metadata };
  });
  const store = new PrismaMemoryKnowledgeStore(input.prisma);
  const reader: MemoryKnowledgeReader = {
    read: async (ref) =>
      entries.find(
        (entry) =>
          entry.ref.entryId === ref.entryId &&
          memoryKnowledgeScopeKey(entry.ref.scope) ===
            memoryKnowledgeScopeKey(ref.scope),
      ) ?? null,
    list: async () => ({ entries, nextCursor: null }),
    recall: async ({ scope }) =>
      entries
        .filter(
          (entry) =>
            memoryKnowledgeScopeKey(entry.ref.scope) ===
            memoryKnowledgeScopeKey(scope),
        )
        .map((entry) => ({ type: "entry" as const, entry })),
  };
  const policy = { getPolicy: async () => defaultMemoryPolicyConfig };
  const unavailable = async (): Promise<never> => {
    throw new Error("paired_reader_fixture_never_delivers_provider_writes");
  };
  const runtime: MemoryKnowledgeRuntime = {
    enabled: true,
    generation: input.generation,
    providerProfileVersion: "paired-approved-source-v1",
    store,
    policy,
    cleanupProof: null,
    automaticSources: new PrismaMemoryAutomaticSourceStore(input.prisma),
    forAutomaticLearning: () => {
      throw new Error("paired_read_only_fixture_never_learns");
    },
    forAccess: (access) =>
      new MemoryKnowledgeService({
        generation: input.generation,
        providerProfileVersion: "paired-approved-source-v1",
        store,
        reader,
        writer: { submit: unavailable },
        observer: { observe: unavailable },
        access,
        policy,
        quota: new UnlimitedMemoryQuotaPolicy(),
      }),
  };
  // Normal command admission creates the same fence before entries are active.
  await input.prisma.memoryKnowledgeMaintenanceFence.create({
    data: {
      generation: input.generation,
      epoch: 0n,
      paused: false,
      actor: "synthetic-approved-fixture",
    },
  });
  for (const scope of [workspace, repository])
    await input.prisma.memoryKnowledgeScopeState.create({
      data: {
        generation: input.generation,
        scopeKey: memoryKnowledgeScopeKey(scope),
        workspaceId: input.workspaceId,
        epoch: 1n,
      },
    });
  for (const entry of entries)
    await input.prisma.memoryKnowledgeEntry.create({
      data: {
        generation: input.generation,
        scopeKey: memoryKnowledgeScopeKey(entry.ref.scope),
        workspaceId: input.workspaceId,
        entryId: entry.ref.entryId,
        revision: 1,
        lifecycle: "active",
        metadata: entry.metadata as unknown as Prisma.InputJsonValue,
      },
    });
  return { runtime, store, entries, approval };
}

export async function cleanupApprovedMemoryFixture(
  prisma: PrismaClient,
  generation: string,
  workspaceId: string,
): Promise<void> {
  await prisma.memoryKnowledgeBundleReceipt.deleteMany({
    where: { workspaceId },
  });
  await prisma.memoryKnowledgeCommand.deleteMany({ where: { generation } });
  await prisma.memoryKnowledgeEntry.deleteMany({ where: { generation } });
  await prisma.memoryKnowledgeScopeState.deleteMany({ where: { generation } });
  await prisma.memoryKnowledgeMaintenanceFence.deleteMany({
    where: { generation },
  });
}
