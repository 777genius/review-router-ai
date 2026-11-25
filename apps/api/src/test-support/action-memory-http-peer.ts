import Fastify from "fastify";
import type { PrismaClient } from "@prisma/client";
import type { ActionSessionClaims } from "@reviewrouter/features-action-control-plane";
import {
  MemoryKnowledgeError,
  MemoryKnowledgeService,
  createMemoryBodyHash,
  createMemoryPolicyConfig,
  memoryKnowledgeScopeKey,
  memoryKnowledgeTopicsDigest,
  type MemoryEntryRef,
  type MemoryKnowledgeEntryMetadata,
  type MemoryKnowledgeStore,
  type MemoryProviderEntry,
  type MemoryStoredCommand,
} from "@reviewrouter/features-memory";
import type { MemoryKnowledgeRuntime } from "@reviewrouter/features-memory/composition";
import { GitHubMemorySourceVerifier } from "../github/github-memory-source-verifier";
import { registerActionMemoryV2Routes } from "../action-memory-v2-routes";

/** Real host routes, facade, access and source verifier; bounded in-memory native/store peers. */
export async function createActionMemoryHttpPeer() {
  const now = new Date();
  const session: ActionSessionClaims = {
    workspaceId: "workspace_1",
    repositoryId: "repo_1",
    githubRepositoryId: "1234",
    repository: "acme/project",
    githubActorLogin: "maintainer",
    githubActorId: "11",
    githubRunId: "run_1",
    githubRunAttempt: "1",
    eventName: "issue_comment",
    protocolVersion: 1,
    pullRequestNumber: 7,
    headSha: "a".repeat(40),
    baseSha: "b".repeat(40),
  };
  const source = {
    type: "github_issue_comment" as const,
    sourceId: "github-comment:77",
    nodeId: "IC_fixture_77",
    revision: now.toISOString(),
    updatedAt: now.toISOString(),
    statementAt: now.toISOString(),
    claimedBodyDigest: "c".repeat(64),
    githubRepositoryId: "1234",
    pullRequestNumber: 7,
    headSha: session.headSha!,
    baseSha: session.baseSha!,
    visibility: "private" as const,
  };
  const state = {
    role: "owner" as "owner" | "member" | null,
    selected: true,
    providerReads: 0,
    sourceReads: 0,
    admissions: 0,
  };
  const entries = new Map<string, MemoryKnowledgeEntryMetadata>();
  const provider = new Map<string, MemoryProviderEntry>();
  const commands = new Map<string, MemoryStoredCommand>();
  const receipts = new Map<string, Record<string, unknown>>();
  const repository = {
    id: "repo_1",
    selected: true,
    archived: false,
    githubRepositoryId: 1234n,
    fullName: "acme/project",
    visibility: "private",
    installation: { githubInstallationId: 55n, status: "active" },
  };
  const prisma = {
    repositoryConnection: {
      async findFirst() {
        return state.selected ? repository : null;
      },
    },
    workspaceMember: {
      async findFirst() {
        return state.role ? { role: state.role } : null;
      },
    },
    memoryKnowledgeEntry: {
      async findMany(input: { where: { entryId: string } }) {
        const metadata = entries.get(input.where.entryId);
        return metadata ? [{ metadata }] : [];
      },
    },
    memoryKnowledgeBundleReceipt: {
      async create({ data }: { data: Record<string, unknown> }) {
        receipts.set(String(data.id), data);
        return data;
      },
      async findUnique({ where }: { where: { id: string } }) {
        return receipts.get(where.id) ?? null;
      },
    },
    memoryKnowledgeCommand: {
      async findFirst(input: { where: { id: string } }) {
        const row = commands.get(input.where.id);
        return row ? { entryId: row.operation.ref.entryId } : null;
      },
    },
  } as unknown as PrismaClient;
  const store = {
    async findCommand(input: { commandId: string }) {
      return commands.get(input.commandId) ?? null;
    },
    async findEntry(ref: MemoryEntryRef) {
      return entries.get(ref.entryId) ?? null;
    },
    async scopeEpoch() {
      return "1";
    },
    async maintenanceState() {
      return { generation: "generation_1", epoch: "0", paused: false };
    },
    async admit(input: Parameters<MemoryKnowledgeStore["admit"]>[0]) {
      const { command } = input;
      const prior = commands.get(command.commandId);
      if (prior) {
        if (prior.digest !== input.digest)
          throw new MemoryKnowledgeError("conflict");
        return prior.operation;
      }
      const old = entries.get(command.ref.entryId);
      if ((old?.revision ?? null) !== command.expectedRevision)
        throw new MemoryKnowledgeError("conflict");
      const revision = String(Number(old?.revision ?? "0") + 1);
      const operation = {
        id: command.commandId,
        ref: command.ref,
        revision,
        state: "queued" as const,
      };
      if (command.kind !== "save" && !old)
        throw new MemoryKnowledgeError("not_found");
      const metadata: MemoryKnowledgeEntryMetadata =
        command.kind === "save"
          ? {
              ref: command.ref,
              generation: command.generation,
              revision,
              contentApprovalRevision: revision,
              bodyDigest: createMemoryBodyHash(command.body),
              topicsDigest: memoryKnowledgeTopicsDigest(command.topicIds),
              kind: command.knowledgeKind,
              lifecycle: "active",
              approval: command.approval,
              source: command.source,
              applicability: command.applicability,
              originalStatementAt:
                old?.originalStatementAt ?? command.source.statementAt,
              lastVerifiedAt: now.toISOString(),
              pendingCommandId: command.commandId,
              revocationCommandId: null,
              createdAt: old?.createdAt ?? now.toISOString(),
              updatedAt: now.toISOString(),
            }
          : {
              ...old!,
              revision,
              lifecycle:
                command.kind === "forget" ? "forget_pending" : "retired",
              pendingCommandId: command.commandId,
              revocationCommandId: command.commandId,
            };
      entries.set(command.ref.entryId, metadata);
      commands.set(command.commandId, {
        operation,
        digest: input.digest,
        envelope: command,
        contentApprovalRevision: revision,
        originalStatementAt: metadata.originalStatementAt,
        deliveryExpiresAt: input.deliveryExpiresAt.toISOString(),
        resubmitUntil: input.resubmitUntil.toISOString(),
        approval: command.approval,
      });
      state.admissions += 1;
      return operation;
    },
  } as unknown as MemoryKnowledgeStore;
  const policy = {
    async getPolicy() {
      return createMemoryPolicyConfig({
        memoryEnabled: true,
        authority: {
          membersCanView: true,
          repositoryMaintainerCanManage: false,
        },
      });
    },
  };
  const runtime: MemoryKnowledgeRuntime = {
    enabled: true,
    cleanupProof: null,
    generation: "generation_1",
    providerProfileVersion: "profile_1",
    store,
    policy,
    automaticSources: {} as never,
    forAutomaticLearning() {
      throw new MemoryKnowledgeError("unsupported");
    },
    forAccess(access) {
      return new MemoryKnowledgeService({
        generation: "generation_1",
        providerProfileVersion: "profile_1",
        store,
        policy,
        access,
        quota: {
          async getWorkspaceQuota() {
            return {
              activeItems: { limit: 100 },
              pendingSuggestions: { limit: 100 },
            };
          },
        },
        reader: {
          async read(ref) {
            state.providerReads += 1;
            return provider.get(ref.entryId) ?? null;
          },
          async list() {
            return { entries: [], nextCursor: null };
          },
          async recall(input) {
            return [...provider.values()]
              .filter(
                (entry) =>
                  memoryKnowledgeScopeKey(entry.ref.scope) ===
                  memoryKnowledgeScopeKey(input.scope),
              )
              .map((entry) => ({ type: "entry" as const, entry }));
          },
        },
        writer: {} as never,
        observer: {} as never,
        now: () => now,
      });
    },
  };
  const sourceVerifier = new GitHubMemorySourceVerifier({
    prisma,
    env: {},
    createClient: async () => ({
      request: async () => ({ data: {} }),
      graphql: async <T>() => {
        state.sourceReads += 1;
        return {
          node: {
            __typename: "IssueComment",
            id: source.nodeId,
            updatedAt: source.updatedAt,
            createdAt: source.statementAt,
            url: "https://github.com/acme/project/pull/7#issuecomment-77",
            author: { __typename: "User", login: "maintainer", databaseId: 11 },
            pullRequest: {
              number: 7,
              headRefOid: source.headSha,
              baseRefOid: source.baseSha,
              repository: {
                databaseId: 1234,
                nameWithOwner: "acme/project",
                visibility: "PRIVATE",
              },
            },
          },
        } as T;
      },
    }),
  });
  const app = Fastify({ logger: false });
  await registerActionMemoryV2Routes(app, {
    prisma,
    runtime,
    sourceVerifier,
    repositories: {
      async findSelectedRepositoryByGithubId() {
        return {
          ...repository,
          workspaceId: "workspace_1",
          repositoryId: "repo_1",
          githubRepositoryId: "1234",
          githubInstallationId: "55",
          owner: "acme",
          installationStatus: "active",
        };
      },
    } as never,
    sessions: {
      async verify({ token }: { token: string }) {
        if (token !== "session-token")
          throw new MemoryKnowledgeError("forbidden");
        return session;
      },
    } as never,
    clock: { now: () => now },
  });
  function publish(commandId: string) {
    const stored = commands.get(commandId);
    if (!stored?.envelope) throw new Error("test command missing");
    const command = stored.envelope;
    const metadata = entries.get(command.ref.entryId)!;
    if (command.kind === "save")
      provider.set(command.ref.entryId, {
        ref: command.ref,
        body: command.body,
        bodyDigest: metadata.bodyDigest!,
        contentApprovalRevision: metadata.contentApprovalRevision!,
        kind: metadata.kind,
        topicIds: command.topicIds,
        statementAt: metadata.originalStatementAt!,
        sourceFactIds: ["controlled-source-fact"],
      });
    if (command.kind === "forget") provider.delete(command.ref.entryId);
    entries.set(command.ref.entryId, { ...metadata, pendingCommandId: null });
    commands.set(commandId, {
      ...stored,
      envelope: null,
      operation: {
        ...stored.operation,
        state: command.kind === "forget" ? "cleanup_pending" : "published",
      },
    });
  }
  return {
    app,
    source,
    state,
    entries,
    provider,
    commands,
    publish,
    session,
    runtime,
    prisma,
    now,
  };
}
