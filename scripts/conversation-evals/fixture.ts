import { randomUUID, createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  ProcessConversation,
  PrismaConversationProcessingStore,
  conversationDigest,
  renderConversation,
  type ConversationIdentity,
  type ConversationSnapshot,
  type ConversationSourcePort,
  type ConversationPolicyPort,
  type RequestControls,
  type ConversationMemoryPort,
} from "../../packages/features/conversations/src/index.js";
import type {
  MemoryKnowledgeAccessPort,
  MemoryAutomaticSourceCurrentPort,
  MemoryKnowledgeScope,
  MemoryKnowledgeSource,
  MemoryActor,
} from "../../packages/features/memory/src/index.js";
import { createConfiguredMemorySourcePreview } from "../../packages/features/memory/src/composition/index.js";
import {
  createMemoryKnowledgeRuntime,
  parseMemoryProviderConfig,
  hindsightMemoryBankId,
} from "../../packages/features/memory/src/composition/index.js";
import { createConversationMemoryPort } from "../../apps/api/src/action-conversation-composition.js";
import {
  createConversationPolicy,
  readConversationQualification,
} from "../../apps/api/src/action-conversation-policy.js";
import { admitMemoryReceiptInTransaction } from "../../apps/api/src/review-memory-admission.js";
import type { MemoryKnowledgeAdmissionReceipt } from "../../packages/features/memory/src/index.js";
import { HindsightMemoryStore } from "../../packages/context-memory/src/index.js";
import {
  corpusEventId,
  corpusEventMessages,
  type CorpusEvent,
  type CorpusMessage,
  type CorpusThread,
} from "./corpus.js";

export type Witness = {
  eventId: string;
  processingId: string;
  status: string;
  learningStatus: string;
  effectIds: readonly string[];
  answer: string | null;
  previewCalls: number;
  modelCalls: number;
  inputBytes: number;
  deliveredBodyDigests: string[];
  memoryManifest: Readonly<Record<string, unknown>> | null;
  observedModel: string | null;
  usage: unknown;
  productLatencyMs: number;
  nativeLatencyMs: number;
  inventory: InventoryEntry[];
  retained: (InventoryEntry & { body: string; bodyDigest: string })[];
  effects: {
    id: string;
    entryId: string;
    kind: string;
    state: string;
    actorId: string;
    approvalAuthorityRevision: string;
    scope: MemoryKnowledgeScope;
    sourceId: string | null;
    sourceRevision: string | null;
  }[];
};
export type InventoryEntry = {
  id: string;
  revision: string;
  scope: MemoryKnowledgeScope;
  lifecycle: string;
  body: string | null;
  bodyDigest: string | null;
  kind: string;
  approvalAuthorityRevision: string | null;
  automaticCohortId: string | null;
  automaticCohortEpoch: string | null;
  sourceId: string | null;
  sourceRevision: string | null;
  sourceActor: string | null;
  observedCommit: string | null;
};
const controls = (): RequestControls => ({
  deadlineAt: new Date(Date.now() + 90_000),
  signal: AbortSignal.timeout(90_000),
});
const rawHash = (body: string) =>
  createHash("sha256").update(body, "utf8").digest("hex");

/** Actual product stores/native lifecycle; only source authority is deterministic synthetic fixture data. */
export async function createEvaluationFixture(input: {
  prisma: PrismaClient;
  env: NodeJS.ProcessEnv;
  runId: string;
  scenario: string;
  template: { workspaceId: string; repositoryId: string };
}) {
  const namespace = `eval_${rawHash(`${input.runId}:${input.scenario}`).slice(0, 40)}`;
  const scope: Extract<MemoryKnowledgeScope, { kind: "repository" }> = {
    kind: "repository",
    workspaceId: `${namespace}_workspace`,
    repositoryId: namespace,
  };
  await input.prisma.workspace.create({
    data: {
      id: scope.workspaceId,
      slug: scope.workspaceId,
      name: `Disposable conversation evaluation ${namespace}`,
    },
  });
  await input.prisma.repositoryConnection.create({
    data: {
      id: scope.repositoryId,
      workspaceId: scope.workspaceId,
      externalRepositoryId: namespace,
      owner: "disposable",
      name: namespace,
      fullName: `disposable/${namespace}`,
      defaultBranch: "main",
      visibility: "public",
      selected: true,
      archived: false,
    },
  });
  const nativeConfig = parseMemoryProviderConfig({
    ...input.env,
    REVIEW_ROUTER_MEMORY_NAMESPACE: namespace,
  });
  if (nativeConfig.kind !== "hindsight")
    throw new Error("eval_native_runtime_unavailable");
  const inventory = new HindsightMemoryStore({
    baseUrl: nativeConfig.baseUrl,
    apiKey: nativeConfig.apiKey,
    bankForScope: () => hindsightMemoryBankId(nativeConfig, scope),
    exactStatementStrategy: "router-approved-v1",
  });
  const runtime = await createMemoryKnowledgeRuntime({
    prisma: input.prisma,
    env: { ...input.env, REVIEW_ROUTER_MEMORY_NAMESPACE: namespace },
  });
  if (!runtime.enabled) throw new Error("eval_native_runtime_unavailable");
  const qualification = readConversationQualification(
    input.env.REVIEW_ROUTER_CONVERSATION_QUALIFICATION,
  );
  if (!qualification) throw new Error("eval_gateway_profile_unavailable");
  let capturedReceipt: MemoryKnowledgeAdmissionReceipt | undefined;
  const selectedPolicy = createConversationPolicy({
    prisma: input.prisma,
    runtime,
    env: input.env,
    qualification,
    admitMemory: async (transaction, now) =>
      capturedReceipt
        ? capturedReceipt.scopes.every(
            (section) => section.entries.length === 0,
          ) ||
          admitMemoryReceiptInTransaction(
            transaction,
            runtime,
            capturedReceipt,
            {
              workspaceId: scope.workspaceId,
              repositoryId: scope.repositoryId,
              headSha: snapshot!.headSha,
              task: "conversation",
              now,
            },
          )
        : false,
  });
  const sourceInventory = new Map<
    string,
    {
      revision: string;
      actorId: string;
      body: string;
      updatedAt: string;
      headSha: string;
    }
  >();
  let snapshot: ConversationSnapshot | undefined;
  const memoryActor: MemoryActor = {
    kind: "github_user",
    id: "github-user:eval-maintainer",
    githubUserId: "eval-maintainer",
    login: "maintainer",
  };
  const source = (value: ConversationSnapshot): MemoryKnowledgeSource => {
    const selected = value.messages.find(
      (message) => message.id === value.sourceId,
    )!;
    return {
      type: "github_comment",
      sourceId: value.sourceId,
      revision: value.sourceRevision,
      repositoryId: scope.repositoryId,
      pullRequestNumber: value.pullRequestNumber,
      updatedAt: value.sourceUpdatedAt,
      statementAt: value.sourceUpdatedAt,
      visibility: value.visibility,
      claimedBodyDigest: selected.bodyDigest,
      observedCommitSha: value.headSha,
      url: `https://example.invalid/disposable/${namespace}/${value.sourceCommentId}`,
    };
  };
  const current: MemoryAutomaticSourceCurrentPort = {
    async current({ source: requested, binding }) {
      const item = sourceInventory.get(requested.sourceId);
      return Boolean(
        item &&
        item.revision === requested.revision &&
        item.actorId === binding.sourceActorId &&
        item.headSha === binding.observedCommitSha,
      );
    },
  };
  const access: MemoryKnowledgeAccessPort = {
    async authorize({ scope: requested, actor: who }) {
      if (
        requested.workspaceId !== scope.workspaceId ||
        (requested.kind !== "workspace" &&
          (requested.kind !== "repository" ||
            requested.repositoryId !== scope.repositoryId)) ||
        !["github_user", "system"].includes(who.kind)
      )
        throw new Error("eval_fixture_scope_forbidden");
    },
    async verifySource({ source: requested, actor: who }) {
      const item = sourceInventory.get(requested.sourceId);
      if (
        !item ||
        item.revision !== requested.revision ||
        item.actorId !== who.id
      )
        throw new Error("eval_fixture_source_forbidden");
      return requested;
    },
    async sourceApplicable({ source: requested }) {
      return (
        sourceInventory.get(requested.sourceId)?.revision === requested.revision
      );
    },
  };
  const service = runtime.forAccess(access, current);
  const records = new PrismaConversationProcessingStore(input.prisma, {
    workspaceId: scope.workspaceId,
    repositoryId: scope.repositoryId,
  });
  const sources: ConversationSourcePort & MemoryAutomaticSourceCurrentPort = {
    current: current.current,
    async identify() {
      if (!snapshot) throw new Error("eval_snapshot_missing");
      return snapshot;
    },
    async read() {
      if (!snapshot) throw new Error("eval_snapshot_missing");
      return snapshot;
    },
    async isCurrent(value) {
      return snapshot?.threadDigest === value.threadDigest;
    },
    async revokeDeleted() {
      if (!snapshot) throw new Error("eval_snapshot_missing");
      sourceInventory.delete(snapshot.sourceId);
      await runtime.automaticSources.invalidate({
        scope,
        sourceId: snapshot.sourceId,
        cause: "deleted",
        now: new Date(),
      });
    },
  };
  let previewCalls = 0,
    modelCalls = 0,
    inputBytes = 0,
    nativeLatencyMs = 0,
    observedModel: string | null = null,
    usage: unknown = null,
    deliveredBodyDigests: string[] = [],
    memoryManifest: Witness["memoryManifest"] = null;
  const preview = createConfiguredMemorySourcePreview({
    ...input.env,
    REVIEW_ROUTER_MEMORY_NAMESPACE: namespace,
  });
  const observedPreview = {
    async preview(...args: Parameters<typeof preview.preview>) {
      previewCalls++;
      const start = Date.now();
      try {
        return await preview.preview(...args);
      } finally {
        nativeLatencyMs += Date.now() - start;
      }
    },
  };
  const readInventory = async (): Promise<InventoryEntry[]> => {
    const page = await service.list(
      { actor: memoryActor, scope, limit: 100 },
      controls(),
    );
    if (page.nextCursor)
      throw new Error("eval_readback_exceeds_bounded_fixture");
    return page.entries.map((entry) => ({
      id: entry.metadata.ref.entryId,
      revision: entry.metadata.revision,
      scope: entry.metadata.ref.scope,
      lifecycle: entry.metadata.lifecycle,
      body: entry.body,
      bodyDigest: entry.metadata.bodyDigest,
      kind: entry.metadata.kind,
      approvalAuthorityRevision:
        entry.metadata.approval?.authorityRevision ?? null,
      automaticCohortId: entry.metadata.automaticSource?.cohortId ?? null,
      automaticCohortEpoch: entry.metadata.automaticSource?.epoch ?? null,
      sourceId: entry.metadata.source?.sourceId ?? null,
      sourceRevision: entry.metadata.source?.revision ?? null,
      sourceActor: entry.metadata.automaticSource?.sourceActorId ?? null,
      observedCommit: entry.metadata.applicability.observedCommitSha,
    }));
  };
  const readback = async () =>
    (await readInventory()).filter(
      (entry): entry is InventoryEntry & { body: string; bodyDigest: string } =>
        entry.body !== null && entry.bodyDigest !== null,
    );
  const drain = async (operationIds: readonly string[]) => {
    for (const commandId of operationIds) {
      for (let count = 0; count < 80; count++) {
        const operation = await service.deliver(
          { scope, commandId },
          controls(),
        );
        if (
          operation?.state === "published" ||
          operation?.state === "completed"
        )
          break;
        if (
          operation?.state === "unknown" ||
          operation?.state === "failed" ||
          operation?.state === "cleanup_pending"
        )
          throw new Error(`eval_native_delivery_${operation.state}`);
        if (count === 79) throw new Error("eval_native_readback_deadline");
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  };
  const actualMemory = createConversationMemoryPort({
    runtime,
    scope,
    sources,
    preview: observedPreview,
    managed: (value) => ({ service, access, source: source(value) }),
    clock: { now: () => new Date() },
    contextAccess: () => access,
    onReceipt: (receipt) => {
      capturedReceipt = receipt;
    },
  });
  const memory: ConversationMemoryPort = {
    ...actualMemory,
    async context(value, budget) {
      const captured = await actualMemory.context(value, budget);
      memoryManifest = captured.manifest;

      return captured;
    },
  };
  // Account/model/custody remain with the production selected-account policy.
  const policy: ConversationPolicyPort = {
    async capture(identity, processingId, budget) {
      const base = await selectedPolicy.capture(
        {
          ...identity,
          workspaceId: input.template.workspaceId,
          repositoryId: input.template.repositoryId,
        },
        processingId,
        budget,
      );
      const inference = base.inference;
      return {
        ...base,
        automaticLearning:
          base.automaticLearning &&
          (activeThread?.policy.automaticLearning ?? false),
        discussionReplies:
          base.discussionReplies &&
          (activeThread?.policy.discussionReplies ?? false),
        inference: {
          async generate(request, requestBudget) {
            modelCalls++;
            inputBytes = Buffer.byteLength(JSON.stringify(request));
            const actualMemory = request.messages
              .flatMap((message) => {
                try {
                  return [
                    String(
                      (JSON.parse(message.content) as { memory?: string })
                        .memory ?? "",
                    ),
                  ];
                } catch {
                  return [];
                }
              })
              .join("\n");
            deliveredBodyDigests = (await readback())
              .filter((entry) =>
                actualMemory.includes(JSON.stringify(entry.body).slice(1, -1)),
              )
              .map((entry) => entry.bodyDigest);
            const output = await inference.generate(request, requestBudget);
            observedModel = output.actualModel;
            usage = output.usage;
            return output;
          },
        },
      };
    },
  };
  const effectHistory = new Map<string, Witness["effects"][number]>();
  const process = new ProcessConversation({
    sources,
    records,
    policies: policy,
    memory,
  });
  let activeThread: CorpusThread | undefined;
  const commentIds = new Map<string, string>();
  async function setSource(thread: CorpusThread, event: CorpusEvent) {
    activeThread = thread;
    const visible = corpusEventMessages(thread, event);
    const selected = visible.find((message) => message.id === event.messageId)!;
    const actorId = (message: CorpusMessage) =>
      message.actorKind === "bot"
        ? "github-bot:eval-router"
        : `github-user:eval-${message.actor}`;
    const visibleIds = new Set(
      visible.map((message) => `${namespace}:${message.id}`),
    );
    for (const original of thread.messages.filter(
      (message) => message.actorKind === "human",
    )) {
      const id = `${namespace}:${original.id}`;
      if (sourceInventory.has(id) && !visibleIds.has(id)) {
        sourceInventory.delete(id);
        await runtime.automaticSources.invalidate({
          scope,
          sourceId: id,
          cause: "deleted",
          now: new Date(),
        });
      }
    }
    for (const message of visible) {
      const id = `${namespace}:${message.id}`;
      const old = sourceInventory.get(id);
      if (
        old &&
        old.revision !== `${message.updatedAt}:${rawHash(message.body)}`
      )
        await runtime.automaticSources.invalidate({
          scope,
          sourceId: id,
          cause: "changed",
          now: new Date(),
        });
    }
    for (const message of visible)
      if (message.actorKind === "human")
        sourceInventory.set(`${namespace}:${message.id}`, {
          revision: `${message.updatedAt}:${rawHash(message.body)}`,
          actorId: actorId(message),
          body: message.body,
          updatedAt: message.updatedAt,
          headSha: thread.headSha,
        });
    const stableSourceId = `${namespace}:${selected.id}`;
    if (!commentIds.has(stableSourceId))
      commentIds.set(stableSourceId, String(commentIds.size + 1));
    const identity: ConversationIdentity = {
      workspaceId: scope.workspaceId,
      repositoryId: scope.repositoryId,
      repositoryStableId: `synthetic:${namespace}`,
      repositoryFullName: `disposable/${namespace}`,
      pullRequestNumber: 1,
      threadId: `${namespace}:${thread.id}`,
      sourceId: `${namespace}:${selected.id}`,
      sourceCommentId: commentIds.get(stableSourceId)!,
      sourceRevision: `${selected.updatedAt}:${rawHash(selected.body)}`,
      sourceUpdatedAt: selected.updatedAt,
      sourceActor: {
        id: actorId(selected),
        login: selected.actor,
        kind: selected.actorKind,
      },
    };
    const messages = visible.map((message, i) => ({
      id: `${namespace}:${message.id}`,
      commentId: String(i + 1),
      actor: {
        id: actorId(message),
        login: message.actor,
        kind: message.actorKind,
      },
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
      replyTo: message.replyTo ? `${namespace}:${message.replyTo}` : null,
      body: message.body,
      bodyDigest: rawHash(message.body),
    }));
    snapshot = {
      ...identity,
      messages,
      visibility: "public",
      headSha: thread.headSha,
      baseSha: "0".repeat(40),
      anchor: {
        path: thread.anchor.path,
        line: thread.anchor.line,
        side: thread.anchor.side,
        originalLine: thread.anchor.line,
        commitSha: thread.headSha,
        originalCommitSha: thread.headSha,
        diffHunk: thread.anchor.code,
      },
      threadDigest: conversationDigest(messages),
      parentCommentId: "1",
      sourceMaintainer: selected.role === "maintainer",
      repliesInThread: thread.policy.existingThreadReplies,
      repliesInPullRequest: thread.policy.existingPrReplies,
      replyComments: [],
    };
  }
  return {
    namespace,
    scope,
    async coldStart() {
      const [entries, count, native] = await Promise.all([
        readInventory(),
        input.prisma.conversationProcessing.count({
          where: {
            workspaceId: scope.workspaceId,
            repositoryId: scope.repositoryId,
          },
        }),
        inventory.listSources({ scope: namespace, limit: 100 }, controls()),
      ]);
      if (entries.length || count || native.sources.length || native.nextCursor)
        throw new Error("eval_cold_start_failed");
      return {
        productEntries: entries.length,
        nativeDocuments: native.sources.length,
        processingRecords: count,
        scopeDigest: conversationDigest(scope),
        nativeNamespace: namespace,
      };
    },
    async run(thread: CorpusThread, event: CorpusEvent): Promise<Witness> {
      previewCalls = 0;
      modelCalls = 0;
      inputBytes = 0;
      nativeLatencyMs = 0;
      observedModel = null;
      usage = null;
      deliveredBodyDigests = [];
      memoryManifest = null;
      await setSource(thread, event);
      const start = Date.now();
      const result = await process.execute(
        {
          pullRequestNumber: 1,
          sourceCommentId: snapshot!.sourceCommentId,
          sourceRevision: snapshot!.sourceUpdatedAt,
          eventAction: event.action,
        },
        controls(),
      );
      const productLatencyMs = Date.now() - start;
      for (const id of result.learning.effectIds) {
        if (effectHistory.has(id)) continue;
        const row = await runtime.store.findCommand({
          commandId: id,
          scope,
          generation: runtime.generation,
        });
        if (!row?.envelope) throw new Error("eval_effect_envelope_unavailable");
        const command = row.envelope;
        const metadata = await runtime.store.findEntry(
          command.ref,
          runtime.generation,
        );
        effectHistory.set(id, {
          id,
          entryId: command.ref.entryId,
          kind: command.kind,
          state: row.operation.state,
          actorId: row.approval.actor.id,
          approvalAuthorityRevision: row.approval.authorityRevision,
          scope: command.ref.scope,
          sourceId:
            command.kind === "save"
              ? command.source.sourceId
              : (metadata?.source?.sourceId ?? null),
          sourceRevision:
            command.kind === "save"
              ? command.source.revision
              : (metadata?.source?.revision ?? null),
        });
      }
      const drainStarted = Date.now();
      await drain(result.learning.effectIds);
      nativeLatencyMs += Date.now() - drainStarted;
      const inventory = await readInventory();
      const retained = inventory.filter(
        (
          entry,
        ): entry is InventoryEntry & { body: string; bodyDigest: string } =>
          entry.body !== null && entry.bodyDigest !== null,
      );
      const effects: Witness["effects"] = [];
      for (const id of result.learning.effectIds) {
        const row = await runtime.store.findCommand({
          commandId: id,
          scope,
          generation: runtime.generation,
        });
        if (!row) throw new Error("eval_effect_readback_missing");
        effects.push({ ...effectHistory.get(id)!, state: row.operation.state });
      }
      return {
        eventId: corpusEventId(thread, event),
        processingId: result.processingId,
        status: result.status,
        learningStatus: result.learning.status,
        effectIds: result.learning.effectIds,
        answer: result.reply?.body ?? null,
        previewCalls,
        modelCalls,
        inputBytes,
        deliveredBodyDigests,
        memoryManifest,
        observedModel,
        usage,
        productLatencyMs,
        nativeLatencyMs,
        inventory,
        retained,
        effects,
      };
    },
    async mutate(kind: "retire" | "forget") {
      const entries = await readback();
      const effects = [];
      const effectProofs: Witness["effects"] = [];
      for (const entry of entries) {
        const ref = { type: "entry" as const, scope, entryId: entry.id };
        const metadata = await service.metadata(ref);
        if (!metadata) throw new Error("eval_mutation_target_unavailable");
        const command = {
          kind,
          commandId: randomUUID(),
          ref,
          expectedRevision: metadata.revision,
          generation: runtime.generation,
          providerProfileVersion: runtime.providerProfileVersion,
          approval: {
            actor: memoryActor,
            approvedAt: new Date().toISOString(),
            authorityRevision: "explicit-evaluation-owner-decision",
          },
        };
        const operation =
          kind === "forget"
            ? await service.forget({ ...command, kind: "forget" }, controls())
            : await service.retire({ ...command, kind: "retire" }, controls());
        effects.push(operation.id);
        const row = await runtime.store.findCommand({
          commandId: operation.id,
          scope,
          generation: runtime.generation,
        });
        if (!row || row.operation.ref.entryId !== entry.id)
          throw new Error("eval_mutation_readback_missing");
        effectProofs.push({
          id: operation.id,
          entryId: row.operation.ref.entryId,
          kind,
          state: row.operation.state,
          actorId: row.approval.actor.id,
          approvalAuthorityRevision: row.approval.authorityRevision,
          scope: row.operation.ref.scope,
          sourceId: metadata.source?.sourceId ?? null,
          sourceRevision: metadata.source?.revision ?? null,
        });
      }
      // Immediate read exclusion is the release gate; physical forget may remain pending.
      const current = await readback();
      if (current.length)
        throw new Error("eval_mutation_did_not_revoke_new_reads");
      return {
        effectIds: effects,
        effects: effectProofs,
        kind,
        revokedEntryIds: entries.map((entry) => entry.id),
        revokedBodyDigests: entries.map((entry) => entry.bodyDigest),
        currentVisible: current.length,
      };
    },
    async nativeOnly(thread: CorpusThread, event: CorpusEvent) {
      if (event.action === "deleted")
        return {
          status: "not_applicable",
          reason: "deleted_source_no_preview",
        };
      await setSource(thread, event);
      const selected = snapshot!.messages.find(
        (message) => message.id === snapshot!.sourceId,
      )!;
      return observedPreview.preview(
        {
          scope: JSON.stringify([
            scope.workspaceId,
            "repository",
            scope.repositoryId,
          ]),
          source: {
            id: snapshot!.sourceId,
            revision: snapshot!.sourceRevision,
            body: selected.body,
          },
          readOnlyContext: renderConversation(snapshot!),
          maxStatements: 4,
        },
        controls(),
      );
    },
  };
}
