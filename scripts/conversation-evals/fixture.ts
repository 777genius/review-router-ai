import { randomUUID, createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  ProcessConversation,
  PrismaConversationProcessingStore,
  conversationDigest,
  type ConversationIdentity,
  type ConversationSnapshot,
  type ConversationSourcePort,
  type ConversationPolicyPort,
  type RequestControls,
  type ConversationMemoryPort,
  type ConversationAction,
  renderConversation,
} from "../../packages/features/conversations/src/index.js";
import type {
  MemoryKnowledgeAccessPort,
  MemoryAutomaticSourceCurrentPort,
  MemoryKnowledgeScope,
  MemoryKnowledgeSource,
  MemoryActor,
  MemoryKnowledgeEntryMetadata,
} from "../../packages/features/memory/src/index.js";
import {
  PrismaWorkspaceMemorySettings,
  PrismaReviewConfigurationRepository,
  PrismaReviewPolicyHeadReader,
  saveWorkspaceMemorySettings,
} from "../../packages/features/review-config/src/index.js";
import { readDurableCommands } from "./command-inventory.js";
import { qualifiedReadback } from "./score-inventory.js";
import { createConfiguredMemorySourcePreview } from "../../packages/features/memory/src/composition/index.js";
import {
  createMemoryKnowledgeRuntime,
  parseMemoryProviderConfig,
  hindsightMemoryBankId,
} from "../../packages/features/memory/src/composition/index.js";
import { memoryKnowledgeScopeKey } from "../../packages/features/memory/src/index.js";
import { approvedMemorySourceApplicable } from "../../packages/features/memory/src/infrastructure/prisma/approved-memory-source-applicable.js";
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
  corpusSourceId,
  canonicalCorpusMessages,
  evaluationProcessingIdentity,
  projectEvaluationSnapshot,
  corpusEventMessages,
  resolveCorpusMessages,
  type CorpusName,
  type EventResolution,
  type TargetBinding,
  type CorpusEvent,
  type CorpusMessage,
  type CorpusThread,
} from "./corpus.js";

export type ExplicitActionProof = {
  action: ConversationAction;
  source: MemoryKnowledgeSource;
  actor: MemoryActor;
  requireConfirmation: boolean;
  settingsRevision: string;
};
export type Witness = {
  sourceIdentity?: "github-node-v1";
  scope?: MemoryKnowledgeScope;
  processingScope?: { workspaceId: string; repositoryId: string };
  policy?: {
    requireConfirmation: boolean;
    settingsRevision: string;
    automaticLearning: boolean;
  };
  resolution?: EventResolution;
  selectedStatements?: string[];
  eventId: string;
  processingId: string;
  status: string;
  learningStatus: string;
  effectIds: readonly string[];
  commandInventoryIds: string[];
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
    explicitAction?: ExplicitActionProof;
    automaticRetirement: {
      generation: string;
      cohortId: string;
      epoch: string;
      ownership: string;
      currentCohortId: string;
      currentEpoch: string;
      currentState: string;
      invalidatedBy: string | null;
      suppressed: boolean;
    } | null;
  }[];
};
export type InventoryEntry = {
  id: string;
  revision: string;
  scope: MemoryKnowledgeScope;
  lifecycle: string;
  body: string | null;
  bodyDigest: string | null;
  unavailableReason:
    | "unsettled"
    | "provider_unavailable"
    | "incomplete_evidence"
    | null;
  explicitCommandId?: string | null;
  activeCohortEligible: boolean;
  sourceCurrent: boolean;
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
  corpusName?: CorpusName;
  repositoryKeys?: string[];
  template: { workspaceId: string; repositoryId: string };
}) {
  const namespace = `eval_${rawHash(`${input.runId}:${input.scenario}`).slice(0, 40)}`;
  const pullRequestNumber =
    Number.parseInt(rawHash(namespace).slice(0, 7), 16) + 1;
  const successor = input.corpusName === "full-thread-v2";
  const repositoryKeys = input.repositoryKeys ?? ["main"];
  const scopes = repositoryKeys.map((key) => ({
    kind: "repository" as const,
    workspaceId: `${namespace}_workspace`,
    repositoryId:
      repositoryKeys.length === 1 ? namespace : `${namespace}_${key}`,
  }));
  let scope = scopes[0]!;
  const templateRepository = await input.prisma.repositoryConnection.findFirst({
    where: {
      id: input.template.repositoryId,
      workspaceId: input.template.workspaceId,
      selected: true,
      archived: false,
    },
    select: { githubRepositoryId: true, fullName: true },
  });
  if (!templateRepository?.githubRepositoryId)
    throw new Error("eval_qualified_processing_identity_missing");
  const processingIdentity = evaluationProcessingIdentity({
    ...input.template,
    githubRepositoryId: String(templateRepository.githubRepositoryId),
    fullName: templateRepository.fullName,
  });
  await input.prisma.workspace.create({
    data: {
      id: scope.workspaceId,
      slug: scope.workspaceId,
      name: `Disposable conversation evaluation ${namespace}`,
    },
  });
  for (const repository of scopes)
    await input.prisma.repositoryConnection.create({
      data: {
        id: repository.repositoryId,
        workspaceId: repository.workspaceId,
        externalRepositoryId: repository.repositoryId,
        owner: "disposable",
        name: repository.repositoryId,
        fullName: `disposable/${repository.repositoryId}`,
        defaultBranch: "main",
        visibility: "public",
        selected: true,
        archived: false,
      },
    });
  const settings = new PrismaWorkspaceMemorySettings(input.prisma);
  const settingsOwnerId = `${namespace}_owner`;
  if (successor) {
    await input.prisma.user.create({ data: { id: settingsOwnerId } });
    await input.prisma.workspaceMember.create({
      data: {
        workspaceId: scope.workspaceId,
        userId: settingsOwnerId,
        role: "owner",
      },
    });
  }
  let currentPolicy = {
    requireConfirmation: false,
    settingsRevision: "0",
    automaticLearning: true,
  };
  const targetBindings: Record<string, TargetBinding> = {};
  const originalTargetBindings = new Map<string, TargetBinding>();
  const resolvedBodies = new Map<string, string>();
  const proposals = new Map<string, string[]>();
  let resolution: EventResolution = { targets: {} };
  let activeEvent: CorpusEvent | undefined;
  let selectedStatements: string[] = [];
  const explicitActions = new Map<string, ExplicitActionProof>();
  const explicitEntryCommands = new Map<string, string>();
  const nativeConfig = parseMemoryProviderConfig({
    ...input.env,
    REVIEW_ROUTER_MEMORY_NAMESPACE: namespace,
  });
  if (nativeConfig.kind !== "hindsight")
    throw new Error("eval_native_runtime_unavailable");
  const inventory = new HindsightMemoryStore({
    baseUrl: nativeConfig.baseUrl,
    apiKey: nativeConfig.apiKey,
    bankForScope: (repositoryId) => {
      const selected = scopes.find((row) => row.repositoryId === repositoryId);
      if (!selected) throw new Error("eval_native_scope_invalid");
      return hindsightMemoryBankId(nativeConfig, selected);
    },
    exactStatementStrategy: "router-approved-v1",
  });
  const runtime = await createMemoryKnowledgeRuntime({
    prisma: input.prisma,
    env: { ...input.env, REVIEW_ROUTER_MEMORY_NAMESPACE: namespace },
    workspaceSettings: (workspaceId, transaction) =>
      new PrismaWorkspaceMemorySettings(transaction ?? input.prisma).read(
        workspaceId,
      ),
  });
  if (!runtime.enabled) throw new Error("eval_native_runtime_unavailable");
  const qualification = readConversationQualification(
    input.env.REVIEW_ROUTER_CONVERSATION_QUALIFICATION,
  );
  if (!qualification) throw new Error("eval_gateway_profile_unavailable");
  let capturedReceipt: MemoryKnowledgeAdmissionReceipt | undefined;
  const selectedPolicy = createConversationPolicy({
    prisma: input.prisma,
    runtime: {
      ...runtime,
      policy: { getPolicy: () => runtime.policy.getPolicy(scope) },
    },
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
      replyTo: string | null;
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
      repositoryId: value.repositoryId,
      pullRequestNumber: value.pullRequestNumber,
      updatedAt: value.sourceUpdatedAt,
      statementAt: value.sourceUpdatedAt,
      visibility: value.visibility,
      claimedBodyDigest: selected.bodyDigest,
      observedCommitSha: value.headSha,
      url: `https://github.com/${value.repositoryFullName}/pull/${value.pullRequestNumber}#discussion_r${value.sourceCommentId}`,
    };
  };
  const current: MemoryAutomaticSourceCurrentPort = {
    async current({ source: requested, binding }) {
      const item = sourceInventory.get(requested.sourceId);
      return Boolean(
        item &&
        item.revision === requested.revision &&
        item.actorId === binding.sourceActorId &&
        item.headSha === binding.observedCommitSha &&
        (binding.contextEvidence?.messages.every((message) => {
          const actual = sourceInventory.get(message.id);
          return (
            actual &&
            actual.updatedAt === message.updatedAt &&
            rawHash(actual.body) === message.bodyDigest &&
            actual.replyTo === message.replyTo
          );
        }) ??
          true),
      );
    },
  };
  const access: MemoryKnowledgeAccessPort = {
    async authorize({ scope: requested, actor: who }) {
      if (
        requested.workspaceId !== scope.workspaceId ||
        (requested.kind !== "workspace" &&
          (requested.kind !== "repository" ||
            !scopes.some(
              (row) => row.repositoryId === requested.repositoryId,
            ))) ||
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
    async sourceApplicable(value, budget) {
      return approvedMemorySourceApplicable(
        {
          ...value,
          ...(value.consumer === "runtime" && snapshot
            ? { headSha: snapshot.headSha }
            : {}),
        },
        budget,
      );
    },
  };
  const service = runtime.forAccess(access, current);
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
        const result = await preview.preview(...args);
        selectedStatements =
          result.status === "complete"
            ? result.statements.map((row) => row.body)
            : [];
        return result;
      } finally {
        nativeLatencyMs += Date.now() - start;
      }
    },
  };
  const metadataHistory = new Map<string, MemoryKnowledgeEntryMetadata>();
  const readInventory = async (): Promise<InventoryEntry[]> => {
    const pages = await Promise.all(
      scopes.map((requested) =>
        service.list(
          { actor: memoryActor, scope: requested, limit: 100 },
          controls(),
        ),
      ),
    );
    const page = {
      entries: pages.flatMap((row) => row.entries),
      nextCursor: pages.some((row) => row.nextCursor),
    };
    if (page.nextCursor)
      throw new Error("eval_readback_exceeds_bounded_fixture");
    for (const entry of page.entries)
      if (entry.metadata.source)
        metadataHistory.set(entry.metadata.ref.entryId, entry.metadata);
    return Promise.all(
      page.entries.map(async (entry) => ({
        id: entry.metadata.ref.entryId,
        ...(successor
          ? {
              explicitCommandId:
                explicitEntryCommands.get(entry.metadata.ref.entryId) ?? null,
            }
          : {}),
        revision: entry.metadata.revision,
        scope: entry.metadata.ref.scope,
        lifecycle: entry.metadata.lifecycle,
        body: entry.body,
        bodyDigest: entry.metadata.bodyDigest,
        unavailableReason: entry.unavailableReason,
        activeCohortEligible: entry.metadata.automaticSource
          ? await runtime.automaticSources.applicable(
              entry.metadata.ref,
              runtime.generation,
              entry.metadata.automaticSource,
            )
          : false,
        sourceCurrent: entry.metadata.approval?.authorityRevision.startsWith(
          "github-command:v2:",
        )
          ? Boolean(
              entry.metadata.source &&
              (await approvedMemorySourceApplicable(
                {
                  actor: memoryActor,
                  scope: entry.metadata.ref.scope,
                  source: entry.metadata.source,
                  consumer: "runtime",
                  ...(entry.metadata.applicability.observedCommitSha
                    ? {
                        headSha: entry.metadata.applicability.observedCommitSha,
                      }
                    : {}),
                },
                controls(),
              )),
            )
          : entry.metadata.source && entry.metadata.automaticSource
            ? await current.current(
                {
                  scope: entry.metadata.ref.scope,
                  source: entry.metadata.source,
                  binding: entry.metadata.automaticSource,
                },
                controls(),
              )
            : Boolean(
                entry.metadata.source &&
                sourceInventory.get(entry.metadata.source.sourceId)
                  ?.revision === entry.metadata.source.revision,
              ),
        kind: entry.metadata.kind,
        approvalAuthorityRevision:
          entry.metadata.approval?.authorityRevision ?? null,
        automaticCohortId: entry.metadata.automaticSource?.cohortId ?? null,
        automaticCohortEpoch: entry.metadata.automaticSource?.epoch ?? null,
        sourceId: entry.metadata.source?.sourceId ?? null,
        sourceRevision: entry.metadata.source?.revision ?? null,
        sourceActor: entry.metadata.approval?.authorityRevision.startsWith(
          "github-command:v2:",
        )
          ? entry.metadata.approval.actor.id
          : (entry.metadata.automaticSource?.sourceActorId ?? null),
        observedCommit: entry.metadata.applicability.observedCommitSha,
      })),
    );
  };
  const readback = async () =>
    (await readInventory()).filter(qualifiedReadback);
  const drain = async (operationIds: readonly string[]) => {
    for (const commandId of operationIds) {
      // Forget fences reads immediately. Physical cleanup remains the existing operator's work.
      if (effectHistory.get(commandId)?.kind === "forget") continue;
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
  const memories = new Map(
    scopes.map((requested) => [
      requested.repositoryId,
      createConversationMemoryPort({
        runtime,
        scope: requested,
        sources,
        preview: observedPreview,
        managed: (value) => ({ service, access, source: source(value) }),
        clock: { now: () => new Date() },
        contextAccess: () => access,
        onReceipt: (receipt) => {
          capturedReceipt = receipt;
        },
      }),
    ]),
  );
  const actualMemory = () => memories.get(scope.repositoryId)!;
  const memory: ConversationMemoryPort = {
    async context(value, budget) {
      const captured = await actualMemory().context(
        projectEvaluationSnapshot(value, scope),
        budget,
      );
      memoryManifest = captured.manifest;
      return captured;
    },
    async learn(value, processingId, revision, budget) {
      return actualMemory().learn(
        projectEvaluationSnapshot(value, scope),
        processingId,
        revision,
        budget,
      );
    },
    async action(value, processingId, intent, budget) {
      value = projectEvaluationSnapshot(value, scope);
      const proof: ExplicitActionProof = {
        action: intent,
        source: source(value),
        actor: {
          kind: "github_user",
          id: value.sourceActor.id,
          githubUserId: value.sourceActor.id.replace("github-user:", ""),
          login: value.sourceActor.login,
        },
        requireConfirmation: currentPolicy.requireConfirmation,
        settingsRevision: currentPolicy.settingsRevision,
      };
      const result = await actualMemory().action(
        value,
        processingId,
        intent,
        budget,
      );
      for (const id of result.effectIds) explicitActions.set(id, proof);
      return result;
    },
  };
  // Account/model/custody remain with the production selected-account policy.
  const policy: ConversationPolicyPort = {
    async capture(identity, processingId, budget) {
      const base = await selectedPolicy.capture(identity, processingId, budget);
      const selectedSettings = successor
        ? await settings.read(scope.workspaceId)
        : null;
      currentPolicy = {
        requireConfirmation: selectedSettings?.requireConfirmation ?? false,
        settingsRevision: selectedSettings
          ? String(selectedSettings.version ?? 0)
          : "0",
        automaticLearning:
          base.automaticLearning &&
          (activeEvent?.policy?.automaticLearning ??
            activeThread?.policy.automaticLearning ??
            false),
      };
      const inference = base.inference;
      return {
        ...base,
        automaticLearning: currentPolicy.automaticLearning,
        requireConfirmation: currentPolicy.requireConfirmation,
        isCurrent: async (requestBudget) => {
          if (!(await base.isCurrent(requestBudget))) return false;
          if (!successor) return true;
          const fresh = await settings.read(scope.workspaceId);
          return (
            fresh.version === selectedSettings?.version &&
            fresh.requireConfirmation === selectedSettings?.requireConfirmation
          );
        },
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
            deliveredBodyDigests = (await readInventory())
              .filter(
                (
                  entry,
                ): entry is InventoryEntry & {
                  body: string;
                  bodyDigest: string;
                } => entry.body !== null && entry.bodyDigest !== null,
              )
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
  const observedCommandIds = new Set<string>();
  const processingIds = new Set<string>();
  const commandEvidence = async (
    returnedIds: readonly string[],
    commit: boolean,
  ) => {
    const rows = await readDurableCommands({
      prisma: input.prisma,
      namespace,
      scope,
      generation: runtime.generation,
      knownEntryIds: [...metadataHistory.keys()],
      knownScopes: scopes,
      sourceIds: [...sourceInventory.keys()],
      returnedIds,
      processingIds: [...processingIds],
    });
    const commandInventoryIds = rows.map((row) => row.id);
    if ([...observedCommandIds].some((id) => !commandInventoryIds.includes(id)))
      throw new Error("eval_durable_command_disappeared");
    const effects: Witness["effects"] = [];
    for (const durable of rows) {
      const row = await runtime.store.findCommand({
        commandId: durable.id,
        scope:
          scopes.find(
            (requested) =>
              memoryKnowledgeScopeKey(requested) === durable.scopeKey,
          ) ?? scope,
        generation: runtime.generation,
      });
      if (!row) throw new Error("eval_effect_readback_missing");
      if (!effectHistory.has(durable.id)) {
        const metadata = await runtime.store.findEntry(
          row.operation.ref,
          runtime.generation,
        );
        const known = metadata?.source
          ? metadata
          : metadataHistory.get(durable.entryId);
        if (metadata?.source) metadataHistory.set(durable.entryId, metadata);
        const binding = known?.automaticSource;
        let automaticRetirement: Witness["effects"][number]["automaticRetirement"] =
          null;
        if (durable.commandKind === "retire" && binding) {
          const [ownership, lineage] = await Promise.all([
            input.prisma.memoryAutomaticEntry.findUnique({
              where: {
                generation_scopeKey_entryId: {
                  generation: durable.generation,
                  scopeKey: durable.scopeKey,
                  entryId: durable.entryId,
                },
              },
            }),
            runtime.automaticSources.lookupLineage(scope, binding.lineageKey),
          ]);
          if (
            ownership &&
            lineage &&
            lineage.state !== "unselected" &&
            ownership.lineageKey === binding.lineageKey &&
            ownership.cohortId === binding.cohortId &&
            ownership.epoch === binding.epoch
          )
            automaticRetirement = {
              generation: durable.generation,
              cohortId: ownership.cohortId,
              epoch: ownership.epoch,
              ownership: ownership.ownership,
              currentCohortId: lineage.binding.cohortId,
              currentEpoch: lineage.binding.epoch,
              currentState: lineage.state,
              invalidatedBy: lineage.invalidatedBy ?? null,
              suppressed: lineage.suppressed,
            };
        }
        const explicit = explicitActions.get(durable.id);
        if (explicit) explicitEntryCommands.set(durable.entryId, durable.id);
        const source =
          explicit?.source ??
          (row.envelope?.kind === "save" ? row.envelope.source : known?.source);
        effectHistory.set(durable.id, {
          id: durable.id,
          entryId: durable.entryId,
          kind: durable.commandKind,
          state: row.operation.state,
          actorId: row.approval.actor.id,
          approvalAuthorityRevision: row.approval.authorityRevision,
          scope: row.operation.ref.scope,
          sourceId: source?.sourceId ?? null,
          sourceRevision: source?.revision ?? null,
          ...(explicit ? { explicitAction: explicit } : {}),
          automaticRetirement,
        });
      }
      if (
        !observedCommandIds.has(durable.id) ||
        returnedIds.includes(durable.id)
      )
        effects.push({
          ...effectHistory.get(durable.id)!,
          state: row.operation.state,
        });
    }
    if (commit)
      for (const id of commandInventoryIds) observedCommandIds.add(id);
    return { commandInventoryIds, effects };
  };

  const processes = new Map(
    scopes.map((requested) => [
      requested.repositoryId,
      new ProcessConversation({
        sources,
        records: new PrismaConversationProcessingStore(input.prisma, {
          workspaceId: processingIdentity.workspaceId,
          repositoryId: processingIdentity.repositoryId,
        }),
        policies: policy,
        memory,
      }),
    ]),
  );
  let activeThread: CorpusThread | undefined;
  const commentIds = new Map<string, string>();
  async function setSource(thread: CorpusThread, event: CorpusEvent) {
    activeThread = thread;
    activeEvent = event;
    scope = scopes[repositoryKeys.indexOf(thread.repositoryKey ?? "main")]!;
    if (!scope) throw new Error("eval_fixture_repository_missing");
    if (successor && event.policy?.requireConfirmation !== undefined) {
      const previous = await settings.read(scope.workspaceId);
      await saveWorkspaceMemorySettings(
        {
          workspaceId: scope.workspaceId,
          actor: {
            userId: settingsOwnerId,
            auditActor: `eval-owner:${settingsOwnerId}`,
          },
          requireConfirmation: event.policy.requireConfirmation,
          expectedVersion: previous.version,
        },
        {
          configurations: new PrismaReviewConfigurationRepository(
            input.prisma,
            undefined,
            false,
            undefined,
          ),
          policyHeads: new PrismaReviewPolicyHeadReader(input.prisma),
        },
      );
    }
    if (successor) {
      const actual = await settings.read(scope.workspaceId);
      currentPolicy = {
        requireConfirmation: actual.requireConfirmation,
        settingsRevision: String(actual.version ?? 0),
        automaticLearning:
          event.policy?.automaticLearning ?? thread.policy.automaticLearning,
      };
    }
    for (const requested of event.bindTargets ?? []) {
      const previous = targetBindings[requested.alias];
      const rows = (await readInventory())
        .filter((row) =>
          previous
            ? row.id === previous.entryId
            : row.sourceId ===
              corpusSourceId(namespace, requested.sourceMessageId),
        )
        .sort((a, b) => a.id.localeCompare(b.id));
      const target = rows[previous ? 0 : requested.index];
      if (!target) throw new Error("eval_actual_target_unavailable");
      const bound = {
        entryId: target.id,
        revision: target.revision,
        sourceMessageId: requested.sourceMessageId,
        index: requested.index,
      };
      if (!originalTargetBindings.has(requested.alias))
        originalTargetBindings.set(requested.alias, bound);
      targetBindings[requested.alias] =
        requested.revision === "initial"
          ? originalTargetBindings.get(requested.alias)!
          : bound;
    }
    const confirmed = event.confirmProposal;
    const proposal = confirmed
      ? proposals.get(confirmed.messageId)?.[confirmed.index]
      : undefined;
    if (confirmed && proposal === undefined)
      throw new Error("eval_observed_proposal_missing");
    resolution = {
      targets: structuredClone(targetBindings),
      ...(confirmed ? { confirmation: { ...confirmed, body: proposal! } } : {}),
    };
    const visible = canonicalCorpusMessages(
      successor
        ? resolveCorpusMessages(thread, event, resolution, resolvedBodies)
        : corpusEventMessages(thread, event),
    );
    const selected = visible.find((message) => message.id === event.messageId)!;
    const actorId = (message: CorpusMessage) =>
      message.actorKind === "bot"
        ? "github-bot:eval-router"
        : `github-user:eval-${message.actor}`;
    const visibleIds = new Set(
      visible.map((message) => corpusSourceId(namespace, message.id)),
    );
    for (const original of thread.messages.filter(
      (message) => message.actorKind === "human",
    )) {
      const id = corpusSourceId(namespace, original.id);
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
      const id = corpusSourceId(namespace, message.id);
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
      sourceInventory.set(corpusSourceId(namespace, message.id), {
        revision: `${message.updatedAt}:${rawHash(message.body)}`,
        actorId: actorId(message),
        body: message.body,
        updatedAt: message.updatedAt,
        headSha: thread.headSha,
        replyTo:
          message.id === visible[0]!.id
            ? null
            : (() => {
                const rootId = corpusSourceId(namespace, visible[0]!.id);
                if (!commentIds.has(rootId))
                  commentIds.set(rootId, String(commentIds.size + 1));
                return commentIds.get(rootId)!;
              })(),
      });
    const stableSourceId = corpusSourceId(namespace, selected.id);
    for (const message of visible) {
      const id = corpusSourceId(namespace, message.id);
      if (!commentIds.has(id)) commentIds.set(id, String(commentIds.size + 1));
    }
    if (!commentIds.has(stableSourceId))
      commentIds.set(stableSourceId, String(commentIds.size + 1));
    const root = visible[0]!;
    const rootSource = corpusSourceId(namespace, root.id);
    const rootCommentId = commentIds.get(rootSource)!;
    const identity: ConversationIdentity = {
      ...processingIdentity,
      pullRequestNumber,
      threadId: `github-review-thread:${rootCommentId}`,
      sourceId: corpusSourceId(namespace, selected.id),
      sourceCommentId: commentIds.get(stableSourceId)!,
      sourceRevision: `${selected.updatedAt}:${rawHash(selected.body)}`,
      sourceUpdatedAt: selected.updatedAt,
      sourceActor: {
        id: actorId(selected),
        login: selected.actor,
        kind: selected.actorKind,
      },
    };
    const messages = visible.map((message) => ({
      id: corpusSourceId(namespace, message.id),
      commentId:
        commentIds.get(corpusSourceId(namespace, message.id)) ?? rootCommentId,
      actor: {
        id: actorId(message),
        login: message.actor,
        kind: message.actorKind,
      },
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
      replyTo: message.id === root.id ? null : rootCommentId,
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
      parentCommentId: rootCommentId,
      sourceMaintainer: selected.role === "maintainer",
      repliesInThread: thread.policy.existingThreadReplies,
      repliesInPullRequest: thread.policy.existingPrReplies,
      replyComments: [],
    };
  }
  return {
    namespace,
    scope,
    scopes,
    processingScope: processingIdentity,
    async coldStart() {
      const [entries, count, native, commands] = await Promise.all([
        readInventory(),
        input.prisma.conversationProcessing.count({
          where: {
            workspaceId: processingIdentity.workspaceId,
            repositoryId: processingIdentity.repositoryId,
            OR: [
              { sourceId: { startsWith: `github-node:${namespace}_` } },
              { pullRequestNumber },
            ],
          },
        }),
        Promise.all(
          scopes.map((requested) =>
            inventory.listSources(
              { scope: requested.repositoryId, limit: 100 },
              controls(),
            ),
          ),
        ),
        commandEvidence([], false),
      ]);
      if (
        entries.length ||
        count ||
        native.some((page) => page.sources.length || page.nextCursor) ||
        commands.commandInventoryIds.length
      )
        throw new Error("eval_cold_start_failed");
      return {
        productEntries: entries.length,
        durableCommands: commands.commandInventoryIds.length,
        nativeDocuments: native.reduce(
          (count, page) => count + page.sources.length,
          0,
        ),
        processingRecords: count,
        scopeDigest: conversationDigest(scope),
        nativeNamespace: namespace,
      };
    },
    async run(thread: CorpusThread, event: CorpusEvent): Promise<Witness> {
      selectedStatements = [];
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
      const result = await processes.get(scope.repositoryId)!.execute(
        {
          pullRequestNumber,
          sourceCommentId: snapshot!.sourceCommentId,
          sourceRevision: snapshot!.sourceUpdatedAt,
          eventAction: event.action,
        },
        controls(),
      );
      const productLatencyMs = Date.now() - start;
      processingIds.add(result.processingId);
      // Capture before delivery can purge approved command/source bytes.
      await commandEvidence(result.learning.effectIds, false);
      const drainStarted = Date.now();
      await drain(result.learning.effectIds);
      nativeLatencyMs += Date.now() - drainStarted;
      if (selectedStatements.length)
        proposals.set(event.messageId, [...selectedStatements]);
      const inventory = await readInventory();
      const retained = inventory.filter(qualifiedReadback);
      const commands = await commandEvidence(result.learning.effectIds, true);
      return {
        sourceIdentity: "github-node-v1",
        ...(successor && event.action !== "deleted"
          ? {
              processingScope:
                await input.prisma.conversationProcessing.findUniqueOrThrow({
                  where: { id: result.processingId },
                  select: { workspaceId: true, repositoryId: true },
                }),
            }
          : {}),
        ...(successor
          ? {
              scope,
              policy: { ...currentPolicy },
              resolution: structuredClone(resolution),
              selectedStatements: [...selectedStatements],
            }
          : {}),
        eventId: corpusEventId(thread, event),
        processingId: result.processingId,
        status: result.status,
        learningStatus: result.learning.status,
        effectIds: result.learning.effectIds,
        ...commands,
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
      };
    },
    async mutate(kind: "retire" | "forget") {
      const entries = await readback();
      const effects = [];
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
      }
      const commands = await commandEvidence(effects, true);
      // Immediate read exclusion is the release gate; physical forget may remain pending.
      const current = await readback();
      if (current.length)
        throw new Error("eval_mutation_did_not_revoke_new_reads");
      return {
        effectIds: effects,
        ...commands,
        kind,
        revokedEntryIds: entries.map((entry) => entry.id),
        revokedBodyDigests: entries.map((entry) => entry.bodyDigest),
        currentVisible: current.length,
      };
    },
    async nativeOnly(thread: CorpusThread, event: CorpusEvent) {
      if (
        event.bindTargets ||
        event.confirmProposal ||
        event.expectedReply === "replay_no_new_effects"
      )
        return {
          status: "not_applicable",
          reason: "selection_only_has_no_product_target_or_command",
        };
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
          ...(successor
            ? {
                readOnlyContext: renderConversation(snapshot!),
              }
            : {}),
          maxStatements: 4,
        },
        controls(),
      );
    },
  };
}
