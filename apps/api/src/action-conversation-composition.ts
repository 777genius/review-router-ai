import type { PrismaClient } from "@prisma/client";
import {
  ConversationError,
  ProcessConversation,
  PrismaConversationProcessingStore,
  conversationDigest,
  renderConversation,
  type ConversationMemoryPort,
  type ConversationSnapshot,
} from "@reviewrouter/features-conversations";
import {
  MemoryKnowledgeError,
  memoryKnowledgeBodyVisible,
  type MemoryActor,
  type MemoryAutomaticSourceCurrentPort,
  type MemoryKnowledgeScope,
  type MemoryKnowledgeSource,
} from "@reviewrouter/features-memory";
import {
  approvedMemorySourceApplicable,
  PrismaMemoryKnowledgeAccess,
  PrismaMemoryPermission,
} from "@reviewrouter/features-memory/infrastructure";
import {
  createPrismaAutomaticMemorySourceCurrent,
  createConfiguredMemorySourcePreview,
  type MemoryKnowledgeRuntime,
} from "@reviewrouter/features-memory/composition";
import { readAccountGatewayInteractionCallerSource } from "@reviewrouter/features-workflow-provisioning";
import {
  captureAuthorizedMemoryContext,
  reviewMemoryRuntimeScopes,
} from "./review-memory-runtime.js";
import { prepareActionMemoryCommand } from "./action-memory-command-replay.js";
import {
  createActionMemorySourceService,
  type ActionMemoryV2Dependencies,
} from "./action-memory-v2-routes.js";
import {
  createConversationPolicy,
  createConversationPublicationAuthority,
  conversationScopeQualified,
  readConversationQualification,
} from "./action-conversation-policy.js";
import {
  GitHubConversationSource,
  type ConversationGitHubClient,
} from "./action-conversation-source.js";
import type { ActionConversationDependencies } from "./action-conversation-routes.js";
import { admitMemoryReceiptInTransaction } from "./review-memory-admission.js";

/** One source-current owner shared by review, conversation, investigation and description. */
export function createAutomaticConversationSourceCurrent(
  input: Pick<
    Parameters<typeof createActionConversationComposition>[0],
    "prisma" | "runtime" | "env"
  > & { readonly sourceVerifier: ActionMemoryV2Dependencies["sourceVerifier"] },
): MemoryAutomaticSourceCurrentPort {
  return createPrismaAutomaticMemorySourceCurrent({
    prisma: input.prisma,
    policy: input.runtime.policy,
    env: input.env,
    createClient: async (installationId) =>
      input.sourceVerifier.createClient(
        installationId,
      ) as unknown as import("@reviewrouter/features-memory/composition").MemorySourceGitHubClient,
  });
}

function actor(snapshot: ConversationSnapshot): MemoryActor {
  return {
    kind: "github_user",
    id: snapshot.sourceActor.id,
    githubUserId: snapshot.sourceActor.id.replace("github-user:", ""),
    login: snapshot.sourceActor.login,
  };
}
function source(
  snapshot: ConversationSnapshot,
  observed = true,
): MemoryKnowledgeSource {
  const selected = snapshot.messages.find(
    (message) => message.id === snapshot.sourceId,
  );
  if (!selected) throw new ConversationError("context_incomplete");
  return {
    type: "github_comment",
    sourceId: snapshot.sourceId,
    revision: snapshot.sourceRevision,
    updatedAt: snapshot.sourceUpdatedAt,
    statementAt: snapshot.sourceUpdatedAt,
    repositoryId: snapshot.repositoryId,
    pullRequestNumber: snapshot.pullRequestNumber,
    url: `https://github.com/${snapshot.repositoryFullName}/pull/${snapshot.pullRequestNumber}#discussion_r${snapshot.sourceCommentId}`,
    visibility: snapshot.visibility,
    claimedBodyDigest: selected.bodyDigest,
    observedCommitSha: observed ? snapshot.headSha : null,
  };
}
function commandId(processingId: string) {
  const value = conversationDigest([
    "conversation-explicit-command",
    processingId,
  ]);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-5${value.slice(13, 16)}-a${value.slice(17, 20)}-${value.slice(20, 32)}`;
}
/** One checked continuation of the already completed immutable model operation. */
export async function claimCheckedConversationPublication(
  input: {
    readonly records: import("@reviewrouter/features-conversations").ConversationProcessingStore;
    readonly sources: import("@reviewrouter/features-conversations").ConversationSourcePort;
    readonly now: () => Date;
  },
  processingId: string,
  bodyDigest: string,
): Promise<boolean> {
  const record = await input.records.read(processingId);
  if (
    !record ||
    record.result.status !== "ready" ||
    !record.boundManifest ||
    record.result.reply?.bodyDigest !== bodyDigest ||
    record.deadlineAt <= input.now()
  )
    return false;
  const manifest = JSON.parse(record.boundManifest) as {
    threadDigest?: string;
    headSha?: string;
    baseSha?: string;
    sourceAuthority?: unknown;
  };
  try {
    const deadlineAt = new Date(
      Math.min(record.deadlineAt.getTime(), input.now().getTime() + 8000),
    );
    const current = await input.sources.read(record.identity, {
      deadlineAt,
      signal: AbortSignal.timeout(
        Math.max(1, deadlineAt.getTime() - input.now().getTime()),
      ),
    });
    if (
      current.threadDigest !== manifest.threadDigest ||
      current.headSha !== manifest.headSha ||
      current.baseSha !== manifest.baseSha ||
      conversationDigest(manifest.sourceAuthority) !==
        conversationDigest({
          actorId: current.sourceActor.id,
          maintainer: current.sourceMaintainer,
          visibility: current.visibility,
        })
    ) {
      await input.records.withdrawPublication(processingId);
      return false;
    }
    return input.records.claimPublication(processingId, bodyDigest);
  } catch {
    await input.records.withdrawPublication(processingId);
    return false;
  }
}
export function createConversationMemoryPort(input: {
  readonly runtime: MemoryKnowledgeRuntime;
  readonly scope: Extract<MemoryKnowledgeScope, { kind: "repository" }>;
  readonly sources: import("@reviewrouter/features-conversations").ConversationSourcePort &
    MemoryAutomaticSourceCurrentPort;
  readonly preview: Parameters<
    MemoryKnowledgeRuntime["forAutomaticLearning"]
  >[2];
  readonly managed: (
    snapshot: ConversationSnapshot,
    observed?: boolean,
  ) => {
    readonly service: import("@reviewrouter/features-memory").MemoryKnowledgeService;
    readonly access: import("@reviewrouter/features-memory").MemoryKnowledgeAccessPort;
    readonly source: MemoryKnowledgeSource;
  };
  readonly clock: import("@reviewrouter/shared").Clock;
  readonly contextAccess: (
    snapshot: ConversationSnapshot,
    actor: MemoryActor,
    scopes: readonly MemoryKnowledgeScope[],
  ) => import("@reviewrouter/features-memory").MemoryKnowledgeAccessPort;
  readonly onReceipt?: (
    receipt: import("@reviewrouter/features-memory").MemoryKnowledgeAdmissionReceipt,
    snapshot: ConversationSnapshot,
  ) => void;
}): ConversationMemoryPort {
  const { scope, sources, preview, managed } = input;
  const memory: ConversationMemoryPort = {
    async context(snapshot, controls) {
      const policy = await input.runtime.policy.getPolicy(scope);
      const scopes = reviewMemoryRuntimeScopes(
        {
          workspaceId: scope.workspaceId,
          repositoryConnectionId: scope.repositoryId,
          trustDomain: "trusted_managed",
        },
        policy,
      );
      const runtimeActor: MemoryActor = {
        kind: "system",
        id: `conversation:${snapshot.sourceId}`,
        githubUserId: null,
        login: null,
      };
      const access = input.contextAccess(snapshot, runtimeActor, scopes);
      const context = await captureAuthorizedMemoryContext(
        {
          service: input.runtime.forAccess(access, sources),
          actor: runtimeActor,
          scopes,
          contextPolicy: {
            audience:
              snapshot.visibility === "public" ? "public" : "repository",
            repositoryId: scope.repositoryId,
            allowedTasks: ["conversation"],
          },
        },
        controls,
      );
      input.onReceipt?.(context.receipt, snapshot);
      return {
        ...context,
        admit: (budget) =>
          context.receipt.scopes.every(
            (section) => section.entries.length === 0,
          )
            ? Promise.resolve(true)
            : context.admit(budget),
      };
    },
    async learn(snapshot, processingId, revision, controls) {
      const selected = snapshot.messages.find(
        (message) => message.id === snapshot.sourceId,
      );
      if (!selected || !snapshot.sourceMaintainer)
        return { status: "unavailable", effectIds: [] };
      const bound = managed(snapshot);
      const checkedSource: MemoryAutomaticSourceCurrentPort = {
        current: async (value, budget) =>
          (await sources.isCurrent(snapshot, budget)) &&
          sources.current(value, budget),
      };
      const learning = input.runtime.forAutomaticLearning(
        bound.access,
        checkedSource,
        preview,
      );
      const effect = await learning.learn(
        {
          processingId,
          scope,
          source: source(snapshot),
          sourceActor: actor(snapshot),
          policyRevision: revision,
          threadId: snapshot.threadId,
          threadDigest: snapshot.threadDigest,
          headSha: snapshot.headSha,
          selectableBody: selected.body,
          readOnlyContext: renderConversation(snapshot),
        },
        controls,
      );
      return {
        status:
          effect.state === "active" && effect.entryIds.length === 0
            ? "complete_empty"
            : effect.state,
        effectIds: effect.operations.map((operation) => operation.id),
      };
    },
    async action(snapshot, processingId, intent, controls) {
      if (
        !snapshot.sourceMaintainer ||
        !(await sources.isCurrent(snapshot, controls))
      )
        throw new ConversationError("forbidden");
      const id = commandId(processingId);
      const ref = {
        type: "entry" as const,
        scope,
        entryId:
          intent.kind === "create"
            ? `mem_${id.replaceAll("-", "")}`
            : intent.entryId,
      };
      const target =
        intent.kind === "create"
          ? null
          : await input.runtime.store.findEntry(ref, input.runtime.generation);
      const bound = managed(
        snapshot,
        intent.kind === "create"
          ? intent.knowledgeKind === "observation"
          : target?.kind === "observation",
      );
      const service = input.runtime.forAccess(bound.access, sources);
      const exceptionRule =
        intent.kind === "create" && intent.knowledgeKind === "exception"
          ? { type: "entry" as const, scope, entryId: intent.exceptionRuleId }
          : null;
      if (exceptionRule) {
        const rule = await service.read(
          { actor: actor(snapshot), ref: exceptionRule },
          controls,
        );
        if (rule.metadata.kind !== "rule" || rule.body === null)
          return {
            notice:
              "That rule is not currently available. Please identify the current rule before creating an exception.",
            effectIds: [],
            status: "needs_input",
          };
      }
      if (intent.kind === "relearn") {
        await service.relearnAutomatic(
          {
            actor: actor(snapshot),
            ref,
            expectedRevision: intent.expectedRevision,
          },
          controls,
        );
        return {
          notice:
            "Automatic learning suppression is cleared for that source. A new authorized source revision may be learned.",
          effectIds: [],
          status: "relearn_authorized",
        };
      }
      const expectedRevision =
        intent.kind === "create" ? null : intent.expectedRevision;
      const prepared = await prepareActionMemoryCommand({
        store: input.runtime.store,
        generation: input.runtime.generation,
        ref,
        actor: actor(snapshot),
        source: bound.source,
        commandId: id,
        expectedRevision,
        wire: intent,
        now: input.clock.now(),
      });
      let operation = prepared.replay;
      if (!operation) {
        const common = {
          commandId: id,
          ref,
          expectedRevision,
          generation: input.runtime.generation,
          providerProfileVersion: input.runtime.providerProfileVersion,
          approval: prepared.approval,
        };
        if (intent.kind === "retire")
          operation = await service.retire(
            {
              ...common,
              expectedRevision: intent.expectedRevision,
              kind: "retire",
            },
            controls,
          );
        else if (intent.kind === "forget")
          operation = await service.forget(
            {
              ...common,
              expectedRevision: intent.expectedRevision,
              kind: "forget",
            },
            controls,
          );
        else if (intent.kind === "create" || intent.kind === "update") {
          const current =
            intent.kind === "update"
              ? await service.read({ actor: actor(snapshot), ref }, controls)
              : null;
          if (intent.kind === "update" && (!current || current.body === null))
            return {
              notice:
                "That entry is not currently available. Please identify a current entry and revision.",
              effectIds: [],
            };
          operation = await service.save(
            {
              ...common,
              kind: "save",
              body: intent.body,
              knowledgeKind:
                intent.kind === "create"
                  ? intent.knowledgeKind
                  : current!.metadata.kind,
              topicIds: current?.topicIds ?? [],
              source: bound.source,
              applicability:
                intent.kind === "update"
                  ? current!.metadata.applicability
                  : {
                      validUntil: null,
                      observedCommitSha:
                        intent.knowledgeKind === "observation"
                          ? snapshot.headSha
                          : null,
                      exceptionRule,
                    },
              temporalMode: "preserve_original",
            },
            controls,
          );
        }
      }
      if (!operation) throw new ConversationError("unavailable");
      let notice =
        operation.state === "published"
          ? "The memory entry is published and available to new requests."
          : operation.state === "submitted" ||
              operation.state === "queued" ||
              operation.state === "processing"
            ? "The memory operation is queued; publication is not confirmed yet."
            : operation.state === "cleanup_pending"
              ? "The entry is revoked for new admissions. Physical deletion is pending."
              : operation.state === "completed"
                ? "The memory operation is complete."
                : operation.state === "unknown"
                  ? "The operation outcome is unknown. The same operation will be reconciled without repeating it."
                  : `Memory operation status: ${operation.state}.`;
      if (intent.kind === "retire" || intent.kind === "forget") {
        const current = await input.runtime.store.findEntry(
          ref,
          input.runtime.generation,
        );
        const excluded =
          current &&
          !memoryKnowledgeBodyVisible(current, "runtime", input.clock.now());
        notice = excluded
          ? intent.kind === "forget" && operation.state === "completed"
            ? "The entry is excluded from new admissions and physical deletion is complete."
            : `The entry is excluded from new admissions. ${intent.kind === "forget" ? "Physical deletion" : "Native retirement"} status: ${operation.state}.`
          : `Memory ${intent.kind} status: ${operation.state}; admission revocation is not confirmed.`;
      }
      return { notice, effectIds: [operation.id], status: operation.state };
    },
  };
  return memory;
}

/** Actual API composition reuses App custody, memory commands and selected account owners. */
export function createActionConversationComposition(input: {
  readonly prisma: PrismaClient;
  readonly runtime: MemoryKnowledgeRuntime;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly action: ActionMemoryV2Dependencies;
}): ActionConversationDependencies {
  const qualification = readConversationQualification(
    input.env.REVIEW_ROUTER_CONVERSATION_QUALIFICATION,
  );
  const preview = createConfiguredMemorySourcePreview(input.env);
  return {
    repositories: input.action.repositories,
    sessions: input.action.sessions,
    clock: input.action.clock,
    ...(input.action.entitlements
      ? { entitlements: input.action.entitlements }
      : {}),
    qualifiedRuntimeSha: qualification?.runtimeSha ?? null,
    ...(input.action.enabled !== undefined
      ? { enabled: input.action.enabled }
      : {}),
    async task(claims, repository) {
      if (
        !qualification ||
        !conversationScopeQualified(qualification, claims) ||
        !input.env.GITHUB_APP_SLUG
      )
        throw new ConversationError("unavailable");
      const scope: Extract<MemoryKnowledgeScope, { kind: "repository" }> = {
        kind: "repository",
        workspaceId: claims.workspaceId,
        repositoryId: claims.repositoryId,
      };
      const records = new PrismaConversationProcessingStore(
        input.prisma,
        claims,
        {
          authorizePublication: createConversationPublicationAuthority({
            prisma: input.prisma,
            runtime: input.runtime,
            env: input.env,
            qualification,
            identityBindingEpoch: claims.identityBindingEpoch ?? "",
          }),
        },
      );
      const policyRevision = async () => {
        const policy = await input.runtime.policy.getPolicy(scope);
        return `${policy.policyVersion}:${policy.safetyPolicyVersion}:${qualification.proofId}`;
      };
      const createClient = async () =>
        input.action.sourceVerifier.createClient(
          repository.githubInstallationId,
        ) as unknown as ConversationGitHubClient;
      const sources = new GitHubConversationSource({
        claims,
        createClient,
        appSlug: input.env.GITHUB_APP_SLUG,
        sourceProcessingAllowed: async () => {
          if (!conversationScopeQualified(qualification, claims)) return false;
          try {
            const client = await createClient(),
              [owner, repo] = claims.repository.split("/");
            const { data: file } = await client.request<{
              readonly type: string;
              readonly encoding: string;
              readonly size: number;
              readonly content: string;
            }>("GET /repos/{owner}/{repo}/contents/{path}", {
              owner,
              repo,
              path: ".github/workflows/reviewrouter-interaction.yml",
              request: { timeout: 5000 },
            });
            if (
              file.type !== "file" ||
              file.encoding !== "base64" ||
              file.size > 16_384
            )
              return false;
            const current = readAccountGatewayInteractionCallerSource(
              Buffer.from(file.content, "base64").toString("utf8"),
            );
            return current.runtimeSha === qualification.runtimeSha;
          } catch {
            return false;
          }
        },
        standingPolicyRevision: policyRevision,
        async knownSource(commentId) {
          const row = await input.prisma.conversationProcessing.findFirst({
            where: {
              workspaceId: claims.workspaceId,
              repositoryId: claims.repositoryId,
              sourceCommentId: commentId,
            },
            orderBy: { createdAt: "desc" },
            select: {
              sourceId: true,
              sourceActorId: true,
              pullRequestNumber: true,
            },
          });
          return row
            ? {
                sourceId: row.sourceId,
                actorId: row.sourceActorId,
                pullRequestNumber: row.pullRequestNumber,
              }
            : null;
        },
        async revokeSource(sourceId, cause, controls) {
          await input.runtime.automaticSources.invalidate({
            scope,
            sourceId,
            cause,
            now: input.action.clock.now(),
          });
          if (controls.signal?.aborted)
            throw new ConversationError("unavailable");
        },
      });
      const managed = (snapshot: ConversationSnapshot, observed = true) =>
        createActionMemorySourceService(
          input.action,
          actor(snapshot),
          source(snapshot, observed),
          scope,
          {
            source: sources,
            verify: (controls) => sources.isCurrent(snapshot, controls),
          },
        );
      let frozenContext:
        | {
            readonly receipt: import("@reviewrouter/features-memory").MemoryKnowledgeAdmissionReceipt;
            readonly snapshot: ConversationSnapshot;
          }
        | undefined;
      const memory = createConversationMemoryPort({
        runtime: input.runtime,
        scope,
        sources,
        preview,
        managed,
        clock: input.action.clock,
        contextAccess: (snapshot, runtimeActor, scopes) =>
          new PrismaMemoryKnowledgeAccess({
            prisma: input.prisma,
            policy: input.runtime.policy,
            permissions: new PrismaMemoryPermission(input.prisma),
            runtimeGrant: {
              actorId: runtimeActor.id,
              scopes,
              headSha: snapshot.headSha,
            },
            sourceAuthority: {
              verifySource: async () => {
                throw new MemoryKnowledgeError("forbidden");
              },
              sourceApplicable: approvedMemorySourceApplicable,
            },
          }),
        onReceipt: (receipt, snapshot) => {
          frozenContext = { receipt, snapshot };
        },
      });
      return {
        records,
        async reconcile(result) {
          if (result.learning.effectIds.length === 0) return result;
          const record = await records.read(result.processingId);
          if (
            !record?.boundManifest ||
            (
              JSON.parse(record.boundManifest) as {
                memory?: { memoryGeneration?: string };
              }
            ).memory?.memoryGeneration !== input.runtime.generation
          )
            return {
              ...result,
              learning: { ...result.learning, status: "unknown" },
            };
          const currentActor: MemoryActor = {
            kind: "github_user",
            id: `github-user:${claims.githubActorId}`,
            githubUserId: claims.githubActorId ?? null,
            login: claims.githubActorLogin,
          };
          const access = new PrismaMemoryKnowledgeAccess({
            prisma: input.prisma,
            policy: input.runtime.policy,
            permissions: new PrismaMemoryPermission(input.prisma, {
              repositoryMaintainers:
                input.action.sourceVerifier.repositoryMaintainers(),
            }),
          });
          try {
            const budget = {
              deadlineAt: new Date(Date.now() + 2000),
              signal: AbortSignal.timeout(2000),
            };
            await access.authorize(
              { actor: currentActor, scope, action: "read" },
              budget,
            );
            const operations = await Promise.all(
              result.learning.effectIds.map((commandId) =>
                input.runtime.store.findCommand({
                  commandId,
                  scope,
                  generation: input.runtime.generation,
                }),
              ),
            );
            const states = operations.map(
              (operation) => operation?.operation.state ?? "unknown",
            );
            const status =
              [
                "unknown",
                "failed",
                "cleanup_pending",
                "processing",
                "submitted",
                "queued",
              ].find((state) =>
                states.includes(state as (typeof states)[number]),
              ) ??
              (states.every((state) => state === "published")
                ? "published"
                : "completed");
            return { ...result, learning: { ...result.learning, status } };
          } catch {
            return {
              ...result,
              learning: { ...result.learning, status: "unknown" },
            };
          }
        },
        claimPublication: (processingId, bodyDigest) =>
          claimCheckedConversationPublication(
            { records, sources, now: () => input.action.clock.now() },
            processingId,
            bodyDigest,
          ),
        processor: new ProcessConversation({
          sources,
          records,
          memory,
          policies: createConversationPolicy({
            prisma: input.prisma,
            runtime: input.runtime,
            env: input.env,
            qualification,
            admitMemory: async (transaction, now) =>
              frozenContext
                ? frozenContext.receipt.scopes.every(
                    (section) => section.entries.length === 0,
                  ) ||
                  admitMemoryReceiptInTransaction(
                    transaction,
                    input.runtime,
                    frozenContext.receipt,
                    {
                      workspaceId: scope.workspaceId,
                      repositoryId: scope.repositoryId,
                      headSha: frozenContext.snapshot.headSha,
                      task: "conversation",
                      now,
                    },
                  )
                : false,
          }),
        }),
        async verifyPublication(processingId, commentId, result) {
          const record = await records.read(processingId);
          return record
            ? sources.verifyPublished(record.identity, commentId, result, {
                deadlineAt: new Date(Date.now() + 8000),
                signal: AbortSignal.timeout(8000),
              })
            : false;
        },
      };
    },
  };
}
