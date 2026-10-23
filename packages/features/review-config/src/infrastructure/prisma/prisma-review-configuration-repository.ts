import { createHash } from "node:crypto";
import { acquireCurrentScopeGuards } from "@reviewrouter/platform-db";
import {
  readProviderAccountBinding,
  lockProviderAccountBindingUses,
  selectBinding,
  ProviderAccountError,
  assertOpaqueReference,
} from "@reviewrouter/features-provider-accounts";
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  canonicalJson,
  parseRepositoryReviewPolicyOverride,
  parseReviewConfigurationStrict,
  resolveReviewPolicy,
  type RepositoryReviewPolicyOverride,
  type ReviewConfiguration,
  type WorkspaceReviewPolicy,
} from "../../domain/review-configuration";
import {
  reviewConfigurationTargetKey,
  type ReviewConfigurationTarget,
} from "../../domain/review-configuration-target";
import type {
  PersistedReviewConfiguration,
  ReviewConfigurationRepositoryPort,
  ReviewConfigurationOperationInput,
  ReviewConfigurationOperationRepositoryPort,
  ReviewPolicySaveInput,
} from "../../application/ports/review-configuration-repository-port";
import {
  composeEffectiveReviewConfiguration,
  parseStoredReviewPolicy,
  persistedReviewConfiguration,
  readyReviewConfiguration,
  resolveEffectiveReviewConfiguration,
} from "../../application/use-cases/resolve-effective-review-configuration";
import {
  snapshotReviewConfigurationOperation,
  snapshotReviewConfigurationOperationLookup,
} from "../../application/use-cases/save-review-configuration";
import {
  isReviewConfigurationWriteConflictError,
  ReviewConfigurationWriteConflictError as WriteConflict,
} from "../../application/ports/review-configuration-repository-port";
import {
  PrismaReviewPolicyHeadReader,
  readActivePolicyHead,
  type ReviewPolicyReader,
} from "./prisma-review-policy-head-reader";

export class PrismaReviewConfigurationRepository
  implements
    ReviewConfigurationRepositoryPort,
    ReviewConfigurationOperationRepositoryPort
{
  constructor(
    private readonly prisma: PrismaClient,
    private readonly operatorWorkspaceId?: string,
    // Trusted backend composition, never a config or batch request field.
    private readonly personalAccountsEnabled = false,
    private readonly personalWriteActorUserId?: string,
  ) {
    assertOperatorWorkspaceId(operatorWorkspaceId);
  }

  findLatest(target: ReviewConfigurationTarget) {
    return findLatestReviewConfiguration(this.prisma, target);
  }

  async saveNextVersion(
    input: Parameters<ReviewConfigurationRepositoryPort["saveNextVersion"]>[0],
  ): Promise<PersistedReviewConfiguration> {
    for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          (tx) =>
            saveNextReviewConfigurationVersion(
              tx,
              input,
              this.operatorWorkspaceId,
              undefined,
              this.personalAccountsEnabled,
              this.personalWriteActorUserId,
            ),
          { isolationLevel: "Serializable" },
        );
      } catch (error) {
        if (
          isReviewConfigurationWriteConflictError(error) ||
          isPrismaReviewConfigurationWriteConflict(error)
        ) {
          throw new WriteConflict();
        }
        if (
          !isPrismaReviewConfigurationSerializationConflict(error) ||
          attempt === MAX_TRANSACTION_ATTEMPTS
        ) {
          throw error;
        }
      }
    }
    throw new Error("review_configuration_transaction_retry_exhausted");
  }

  deleteTarget(
    target: ReviewConfigurationTarget,
    expectedVersion?: number | null,
  ) {
    return this.prisma.$transaction((tx) =>
      deleteReviewConfigurationTarget(tx, target, expectedVersion),
    );
  }

  async findOperation(
    input: Parameters<
      ReviewConfigurationOperationRepositoryPort["findOperation"]
    >[0],
  ): Promise<PersistedReviewConfiguration | null> {
    const intent = snapshotReviewConfigurationOperationLookup(input);
    const receipt = await findOperationReceipt(
      this.prisma,
      intent.target,
      intent.operationId,
    );
    if (!receipt) return null;
    const policy =
      intent.target.scope === "workspace"
        ? parseStoredReviewPolicy("workspace", receipt.policyJson)
        : parseStoredReviewPolicy("repository", receipt.policyJson);
    if (receipt.schemaVersion !== 3 || !policy)
      throw new Error("review_configuration_receipt_invalid");
    return matchOperationReceipt(
      receipt,
      operationIntentHash({
        target: intent.target,
        expectedVersion: intent.expectedVersion,
        policy,
      }),
    );
  }

  async saveNextVersionWithOperation(
    input: ReviewConfigurationOperationInput,
  ): Promise<PersistedReviewConfiguration> {
    const intent = snapshotReviewConfigurationOperation(input);
    const receipt = {
      operationId: intent.operationId,
      operationIntentHash: operationIntentHash(intent),
    };
    for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          (tx) =>
            saveNextReviewConfigurationVersion(
              tx,
              intent,
              this.operatorWorkspaceId,
              receipt,
              this.personalAccountsEnabled,
              this.personalWriteActorUserId,
            ),
          { isolationLevel: "Serializable" },
        );
      } catch (error) {
        if (
          isPrismaReviewConfigurationWriteConflict(error) ||
          isPrismaReviewConfigurationSerializationConflict(error)
        ) {
          const original = await findOperationReceipt(
            this.prisma,
            intent.target,
            intent.operationId,
          );
          if (original) {
            return matchOperationReceipt(original, receipt.operationIntentHash);
          }
          if (isPrismaReviewConfigurationWriteConflict(error))
            throw new WriteConflict();
        }
        if (
          !isPrismaReviewConfigurationSerializationConflict(error) ||
          attempt === MAX_TRANSACTION_ATTEMPTS
        ) {
          throw error;
        }
      }
    }
    throw new Error("review_configuration_transaction_retry_exhausted");
  }
}

export class PrismaReviewConfigurationTransactionRepository implements ReviewConfigurationRepositoryPort {
  constructor(
    private readonly prisma: Prisma.TransactionClient,
    private readonly operatorWorkspaceId?: string,
    // Trusted backend composition, never a config or batch request field.
    private readonly personalAccountsEnabled = false,
    private readonly personalWriteActorUserId?: string,
  ) {
    assertOperatorWorkspaceId(operatorWorkspaceId);
  }

  findLatest(target: ReviewConfigurationTarget) {
    return findLatestReviewConfiguration(this.prisma, target);
  }

  saveNextVersion(
    input: Parameters<ReviewConfigurationRepositoryPort["saveNextVersion"]>[0],
  ) {
    return saveNextReviewConfigurationVersion(
      this.prisma,
      input,
      this.operatorWorkspaceId,
      undefined,
      this.personalAccountsEnabled,
      this.personalWriteActorUserId,
    );
  }

  deleteTarget(
    target: ReviewConfigurationTarget,
    expectedVersion?: number | null,
  ) {
    return deleteReviewConfigurationTarget(
      this.prisma,
      target,
      expectedVersion,
    );
  }
}

export async function acquireReviewConfigurationWriteScope(
  transaction: Prisma.TransactionClient,
  target: ReviewConfigurationTarget,
): Promise<void> {
  await acquireCurrentScopeGuards(transaction, [
    { ...target, mode: "exclusive" },
  ]);
}

export function isPrismaReviewConfigurationWriteConflict(
  error: unknown,
): boolean {
  return hasPrismaErrorCode(error, "P2002");
}

export function isPrismaReviewConfigurationSerializationConflict(
  error: unknown,
): boolean {
  return hasPrismaErrorCode(error, "P2034");
}

function hasPrismaErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function assertOperatorWorkspaceId(value: string | undefined): void {
  if (
    value !== undefined &&
    /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.exec(value)?.[0] !== value
  ) {
    throw new Error("review_configuration_operator_workspace_id_invalid");
  }
}

const MAX_TRANSACTION_ATTEMPTS = 3;

type ReviewConfigurationPrismaClient = Pick<
  PrismaClient | Prisma.TransactionClient,
  "reviewConfiguration" | "reviewConfigurationVersion"
>;

async function findLatestReviewConfiguration(
  reader: ReviewPolicyReader,
  target: ReviewConfigurationTarget,
): Promise<PersistedReviewConfiguration | null> {
  return readyReviewConfiguration(
    await resolveEffectiveReviewConfiguration(target, {
      policyHeads: new PrismaReviewPolicyHeadReader(reader),
    }),
  );
}

async function saveNextReviewConfigurationVersion(
  prisma: Prisma.TransactionClient,
  input: Parameters<ReviewConfigurationRepositoryPort["saveNextVersion"]>[0],
  operatorWorkspaceId?: string,
  receipt?: {
    readonly operationId: string;
    readonly operationIntentHash: string;
  },
  personalAccountsEnabled = false,
  personalWriteActorUserId?: string,
): Promise<PersistedReviewConfiguration> {
  const target = snapshotTarget(input.target);
  await acquireReviewConfigurationWriteScope(prisma, target);
  if (receipt) {
    const original = await findOperationReceipt(
      prisma,
      target,
      receipt.operationId,
    );
    if (original)
      return matchOperationReceipt(original, receipt.operationIntentHash);
  }
  const policy = parsePolicyForTarget(target, input.policy);
  const targetKey = reviewConfigurationTargetKey(target);
  const workspaceRecord =
    target.scope === "workspace"
      ? null
      : await readActivePolicyHead(prisma, {
          workspaceId: target.workspaceId,
          targetKey: reviewConfigurationTargetKey({
            scope: "workspace",
            workspaceId: target.workspaceId,
          }),
        });
  const workspacePolicy =
    target.scope === "workspace"
      ? (policy as WorkspaceReviewPolicy)
      : workspaceRecord
        ? parseStoredReviewPolicy("workspace", workspaceRecord.policyJson)
        : null;
  if (!workspacePolicy) throw new Error("review_workspace_policy_required");
  const repositoryPolicy =
    target.scope === "repository"
      ? (policy as RepositoryReviewPolicyOverride)
      : null;
  const effective = resolveReviewPolicy(workspacePolicy, repositoryPolicy);
  if (target.scope === "workspace") {
    // The exclusive workspace guard also fences repository writers. Validate
    // sparse descendants together before publishing their inherited policy.
    const repositories = await prisma.reviewConfiguration.findMany({
      where: {
        workspaceId: target.workspaceId,
        repositoryId: { not: null },
        active: true,
      },
      select: {
        versions: {
          orderBy: { version: "desc" },
          take: 1,
          select: { policyJson: true },
        },
      },
    });
    for (const repository of repositories) {
      const version = repository.versions[0];
      if (version) {
        resolveReviewPolicy(
          workspacePolicy,
          parseStoredReviewPolicy("repository", version.policyJson),
        );
      }
    }
  }
  await assertGatewaySelections(
    prisma,
    target.workspaceId,
    effective,
    operatorWorkspaceId,
    personalAccountsEnabled,
    personalWriteActorUserId,
  );

  const configuration = await prisma.reviewConfiguration.upsert({
    where: {
      workspaceId_targetKey: {
        workspaceId: target.workspaceId,
        targetKey,
      },
    },
    update: {
      repositoryId: target.scope === "repository" ? target.repositoryId : null,
    },
    create: {
      workspaceId: target.workspaceId,
      repositoryId: target.scope === "repository" ? target.repositoryId : null,
      targetKey,
    },
    select: { id: true, workspaceId: true, active: true },
  });
  const latest = await prisma.reviewConfigurationVersion.findFirst({
    where: { configurationId: configuration.id },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const currentVersion = configuration.active
    ? (latest?.version ?? null)
    : null;
  if (
    input.expectedVersion !== undefined &&
    currentVersion !== input.expectedVersion
  ) {
    throw new WriteConflict();
  }

  if (!configuration.active) {
    await prisma.reviewConfiguration.update({
      where: { id: configuration.id },
      data: { active: true },
    });
  }
  const saved = await prisma.reviewConfigurationVersion.create({
    data: {
      configurationId: configuration.id,
      ...receipt,
      workspaceId: configuration.workspaceId,
      version: (latest?.version ?? 0) + 1,
      schemaVersion: policy.schemaVersion,
      policyJson: canonicalJson(policy),
      operationSnapshotJson: receipt
        ? canonicalJson({
            workspaceVersion:
              target.scope === "workspace"
                ? (latest?.version ?? 0) + 1
                : workspaceRecord!.version,
            config: effective,
          })
        : null,
      ...derivedPolicyProjection(effective),
      providers: {
        create: effective.providers.map((provider, index) => ({
          order: index,
          gatewayBindingId: provider.gatewayBindingId ?? null,
          gatewayProfileRef: provider.gatewayProfileRef ?? null,
          providerKind: provider.kind,
          providerAuthMode: provider.authMode,
          model: provider.model,
          reasoningEffort: provider.reasoningEffort ?? null,
          agenticContext: provider.agenticContext,
          fastMode: provider.fastMode,
          requiredHealthy: provider.requiredHealthy,
        })),
      },
    },
    select: versionSelect,
  });
  const persisted = readyReviewConfiguration(
    composeEffectiveReviewConfiguration({
      workspace: target.scope === "workspace" ? saved : workspaceRecord,
      repository: target.scope === "repository" ? saved : null,
    }),
  );
  if (!persisted) throw new Error("review_policy_resave_required");
  return persisted;
}

async function deleteReviewConfigurationTarget(
  prisma: Prisma.TransactionClient,
  target: ReviewConfigurationTarget,
  expectedVersion?: number | null,
): Promise<boolean> {
  await acquireReviewConfigurationWriteScope(prisma, target);
  const scope = {
    workspaceId: target.workspaceId,
    targetKey: reviewConfigurationTargetKey(target),
  };
  const current = await readActivePolicyHead(prisma, scope);
  if (
    expectedVersion !== undefined &&
    (current?.version ?? null) !== expectedVersion
  ) {
    throw new WriteConflict();
  }
  const result = await prisma.reviewConfiguration.updateMany({
    where: { ...scope, active: true },
    data: { active: false },
  });
  return result.count > 0;
}

function parsePolicyForTarget(
  target: ReviewConfigurationTarget,
  policy: ReviewPolicySaveInput["policy"],
): WorkspaceReviewPolicy | RepositoryReviewPolicyOverride {
  return target.scope === "workspace"
    ? parseReviewConfigurationStrict(policy)
    : parseRepositoryReviewPolicyOverride(policy);
}

function operationIntentHash(
  intent: Pick<
    ReviewConfigurationOperationInput,
    "target" | "expectedVersion" | "policy"
  >,
): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        target: intent.target,
        expectedVersion: intent.expectedVersion,
        policy: intent.policy,
      }),
    )
    .digest("hex");
}

function matchOperationReceipt(
  original: VersionRecord & {
    readonly operationIntentHash: string | null;
    readonly operationSnapshotJson: string | null;
  },
  intentHash: string,
): PersistedReviewConfiguration {
  if (original.operationIntentHash !== intentHash) throw new WriteConflict();
  // A lost ACK resolves to the committed result, independently of later edits,
  // clear, or revocation. This historical receipt never supplies run authority.
  try {
    const snapshot: unknown = JSON.parse(original.operationSnapshotJson ?? "");
    if (
      !snapshot ||
      typeof snapshot !== "object" ||
      Array.isArray(snapshot) ||
      Object.keys(snapshot).sort().join(",") !== "config,workspaceVersion" ||
      !("workspaceVersion" in snapshot) ||
      !("config" in snapshot) ||
      typeof snapshot.workspaceVersion !== "number" ||
      !Number.isSafeInteger(snapshot.workspaceVersion) ||
      snapshot.workspaceVersion < 1 ||
      (!original.repositoryId && snapshot.workspaceVersion !== original.version)
    )
      throw new Error("invalid_receipt_snapshot");
    const config = parseReviewConfigurationStrict(snapshot.config);
    const policy = original.repositoryId
      ? parseStoredReviewPolicy("repository", original.policyJson)
      : parseStoredReviewPolicy("workspace", original.policyJson);
    if (!policy || original.schemaVersion !== 3)
      throw new Error("invalid_receipt_policy");
    return persistedReviewConfiguration(
      config,
      policy,
      snapshot.workspaceVersion,
      original.repositoryId ? original.version : null,
    );
  } catch {
    throw new Error("review_configuration_receipt_invalid");
  }
}

async function findOperationReceipt(
  prisma: ReviewConfigurationPrismaClient,
  target: ReviewConfigurationTarget,
  operationId: string,
) {
  const record = await prisma.reviewConfigurationVersion.findFirst({
    where: {
      operationId,
      configuration: {
        workspaceId: target.workspaceId,
        targetKey: reviewConfigurationTargetKey(target),
      },
    },
    select: {
      ...versionSelect,
      operationIntentHash: true,
      operationSnapshotJson: true,
      configuration: { select: { repositoryId: true } },
    },
  });
  return record
    ? { ...record, repositoryId: record.configuration.repositoryId }
    : null;
}

function snapshotTarget(
  target: ReviewConfigurationTarget,
): ReviewConfigurationTarget {
  if (
    typeof target.workspaceId !== "string" ||
    !target.workspaceId ||
    (target.scope === "repository" && !target.repositoryId)
  ) {
    throw new Error("review_configuration_target_invalid");
  }
  return target.scope === "repository"
    ? {
        scope: "repository",
        workspaceId: target.workspaceId,
        repositoryId: target.repositoryId,
      }
    : { scope: "workspace", workspaceId: target.workspaceId };
}

function derivedPolicyProjection(config: ReviewConfiguration) {
  const primary = config.providers[0]!;
  return {
    gatewayBindingId: primary.gatewayBindingId ?? null,
    gatewayProfileRef: primary.gatewayProfileRef ?? null,
    providerKind: primary.kind,
    providerAuthMode: primary.authMode,
    model: primary.model,
    reasoningEffort: primary.reasoningEffort ?? null,
    agenticContext: primary.agenticContext,
    fastMode: primary.fastMode,
    failOnSeverity: config.blockingPolicy.failOnSeverity,
    inlineMaxComments: config.limits.inlineMaxComments,
    providerLimit: config.execution.providerLimit,
    providerMaxParallel: config.execution.providerMaxParallel,
    inlineMinAgreement: config.execution.inlineMinAgreement,
    targetTokensPerBatch: config.limits.targetTokensPerBatch,
    reviewLanguage: config.reviewLanguage,
    investigationRecordingEnabled: config.investigationRollout.recordingEnabled,
    investigationShadowEnabled: config.investigationRollout.shadowEnabled,
    investigationContextCriticEnabled:
      config.investigationRollout.contextCriticEnabled,
    investigationVerifiedCleanEnabled:
      config.investigationRollout.verifiedCleanEnabled,
    investigationCrossRevisionReplayEnabled:
      config.investigationRollout.crossRevisionReplayEnabled,
    investigationProductionEffectsEnabled:
      config.investigationRollout.productionEffectsEnabled,
  };
}

/** Capture and lock the saving actor together with all selected donors before
 * any Source/Binding lock. This preserves C2's sorted Member -> Source order.
 * Readonly receipt replay returns before this fresh-write authorization check.
 */
async function lockPersonalWriteActor(
  prisma: Prisma.TransactionClient,
  workspaceId: string,
  bindingIds: readonly string[],
  actorUserId: string | undefined,
): Promise<ReadonlySet<string>> {
  if (!bindingIds.length) return new Set<string>();
  const rows = await prisma.workspaceAccountBinding.findMany({
    where: {
      workspaceId,
      id: { in: [...new Set(bindingIds)] },
      connection: { ownerUserId: { not: null } },
    },
    select: { id: true, connection: { select: { ownerUserId: true } } },
  });
  if (!rows.length) return new Set<string>();
  if (actorUserId === undefined)
    throw new Error("review_configuration_personal_actor_forbidden");
  assertOpaqueReference(actorUserId);
  const scope = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { personalOwnerUserId: true, deletionState: true },
  });
  if (!scope || scope.deletionState !== "active")
    throw new Error("review_configuration_personal_actor_forbidden");
  const users = [
    ...new Set([
      actorUserId,
      ...rows.flatMap((row) =>
        row.connection.ownerUserId ? [row.connection.ownerUserId] : [],
      ),
    ]),
  ];
  const members = await prisma.$queryRaw<
    { userId: string | null; role: string }[]
  >`
    SELECT "userId", "role" FROM "WorkspaceMember" WHERE "workspaceId" = ${workspaceId}
      AND "userId" = ANY(${users}::text[]) ORDER BY "id" FOR SHARE`;
  if (
    scope.personalOwnerUserId !== null
      ? scope.personalOwnerUserId !== actorUserId
      : !members.some(
          (row) =>
            row.userId === actorUserId &&
            (row.role === "owner" || row.role === "admin"),
        )
  )
    throw new Error("review_configuration_personal_actor_forbidden");
  return new Set(rows.map((row) => row.id));
}

async function assertGatewaySelections(
  prisma: Prisma.TransactionClient,
  workspaceId: string,
  config: ReviewConfiguration,
  operatorWorkspaceId?: string,
  personalAccountsEnabled = false,
  personalWriteActorUserId?: string,
): Promise<void> {
  const providers = config.providers.filter(
    (provider) => provider.authMode === "codex_account_gateway",
  );
  const bindingIds = providers.map((provider) => provider.gatewayBindingId!);
  const personalBindings = personalAccountsEnabled
    ? await lockPersonalWriteActor(
        prisma,
        workspaceId,
        bindingIds,
        personalWriteActorUserId,
      )
    : new Set<string>();
  await lockProviderAccountBindingUses(
    prisma,
    workspaceId,
    bindingIds,
    personalAccountsEnabled,
  );
  for (const provider of providers) {
    const bindingId = provider.gatewayBindingId!;
    const selection = await readProviderAccountBinding(
      prisma,
      { workspaceId, bindingId },
      personalAccountsEnabled,
    );
    let selected: ReturnType<typeof selectBinding>;
    try {
      selected = selectBinding(
        workspaceId,
        bindingId,
        selection,
        operatorWorkspaceId,
      );
    } catch (error) {
      if (error instanceof ProviderAccountError)
        throw new Error("review_configuration_gateway_binding_unavailable", {
          cause: error,
        });
      throw error;
    }
    // A row absent from the preliminary immutable-owner read cannot acquire
    // personal write authority by appearing during a later awaited read.
    if (
      selection?.connection.owner.kind === "user" &&
      !personalBindings.has(bindingId)
    )
      throw new Error("review_configuration_personal_actor_forbidden");
    if (selected.profileRef !== provider.gatewayProfileRef)
      throw new Error("review_configuration_gateway_profile_mismatch");
  }
}

const versionSelect = {
  id: true,
  version: true,
  schemaVersion: true,
  policyJson: true,
  providers: {
    orderBy: { order: "asc" },
    select: {
      gatewayBindingId: true,
      gatewayProfileRef: true,
    },
  },
} as const;

type VersionRecord = {
  readonly id: string;
  readonly repositoryId?: string | null;
  readonly version: number;
  readonly schemaVersion: number;
  readonly policyJson: string | null;
  readonly providers: readonly {
    readonly gatewayBindingId: string | null;
    readonly gatewayProfileRef: string | null;
  }[];
};
