import { createHash } from "node:crypto";
import { acquireCurrentScopeGuards } from "@reviewrouter/platform-db";
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
  RepositoryReviewConfiguration,
  ReviewConfigurationBatchReaderPort,
  ReviewConfigurationRepositoryPort,
  ReviewConfigurationOperationInput,
  ReviewConfigurationOperationRepositoryPort,
  ReviewPolicySaveInput,
} from "../../application/ports/review-configuration-repository-port";
import {
  snapshotReviewConfigurationOperation,
  snapshotReviewConfigurationOperationLookup,
} from "../../application/use-cases/save-review-configuration";
import {
  isReviewConfigurationWriteConflictError,
  ReviewConfigurationWriteConflictError as WriteConflict,
} from "../../application/ports/review-configuration-repository-port";

export class PrismaReviewConfigurationRepository
  implements
    ReviewConfigurationRepositoryPort,
    ReviewConfigurationOperationRepositoryPort,
    ReviewConfigurationBatchReaderPort
{
  constructor(
    private readonly prisma: PrismaClient,
    private readonly operatorWorkspaceId?: string,
  ) {
    assertOperatorWorkspaceId(operatorWorkspaceId);
  }

  findLatest(target: ReviewConfigurationTarget) {
    return findLatestReviewConfiguration(this.prisma, target);
  }

  findLatestForRepositories(input: {
    readonly workspaceId: string;
    readonly repositoryIds: readonly string[];
  }) {
    return findLatestReviewConfigurationsForRepositories(this.prisma, input);
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

  deleteTarget(target: ReviewConfigurationTarget) {
    return this.prisma.$transaction((tx) =>
      deleteReviewConfigurationTarget(tx, target),
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
        ? parseStoredPolicy("workspace", receipt.policyJson)
        : parseStoredPolicy("repository", receipt.policyJson);
    if (receipt.schemaVersion !== 3 || !policy)
      throw new Error("review_configuration_receipt_invalid");
    return matchOperationReceipt(
      this.prisma,
      intent.target.workspaceId,
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
            return matchOperationReceipt(
              this.prisma,
              intent.target.workspaceId,
              original,
              receipt.operationIntentHash,
            );
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

export class PrismaReviewConfigurationTransactionRepository
  implements
    ReviewConfigurationRepositoryPort,
    ReviewConfigurationBatchReaderPort
{
  constructor(
    private readonly prisma: Prisma.TransactionClient,
    private readonly operatorWorkspaceId?: string,
  ) {
    assertOperatorWorkspaceId(operatorWorkspaceId);
  }

  findLatest(target: ReviewConfigurationTarget) {
    return findLatestReviewConfiguration(this.prisma, target);
  }

  findLatestForRepositories(input: {
    readonly workspaceId: string;
    readonly repositoryIds: readonly string[];
  }) {
    return findLatestReviewConfigurationsForRepositories(this.prisma, input);
  }

  saveNextVersion(
    input: Parameters<ReviewConfigurationRepositoryPort["saveNextVersion"]>[0],
  ) {
    return saveNextReviewConfigurationVersion(
      this.prisma,
      input,
      this.operatorWorkspaceId,
    );
  }

  deleteTarget(target: ReviewConfigurationTarget) {
    return deleteReviewConfigurationTarget(this.prisma, target);
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
  prisma: ReviewConfigurationPrismaClient,
  target: ReviewConfigurationTarget,
): Promise<PersistedReviewConfiguration | null> {
  const workspace = await findLatestPolicyVersion(prisma, {
    workspaceId: target.workspaceId,
    targetKey: "workspace:default",
  });
  const repository =
    target.scope === "repository"
      ? await findLatestPolicyVersion(prisma, {
          workspaceId: target.workspaceId,
          targetKey: `repo:${target.repositoryId}`,
        })
      : null;
  return composePersistedConfiguration(workspace, repository);
}

async function findLatestReviewConfigurationsForRepositories(
  prisma: ReviewConfigurationPrismaClient,
  input: {
    readonly workspaceId: string;
    readonly repositoryIds: readonly string[];
  },
): Promise<readonly RepositoryReviewConfiguration[]> {
  const repositoryIds = [...new Set(input.repositoryIds)];
  if (repositoryIds.length === 0) return [];
  const workspace = await findLatestPolicyVersion(prisma, {
    workspaceId: input.workspaceId,
    targetKey: "workspace:default",
  });
  const records = await prisma.reviewConfiguration.findMany({
    where: {
      workspaceId: input.workspaceId,
      repositoryId: { in: repositoryIds },
      active: true,
    },
    orderBy: { repositoryId: "asc" },
    select: {
      repositoryId: true,
      versions: {
        orderBy: { version: "desc" },
        take: 1,
        select: versionSelect,
      },
    },
  });
  const repositoryByVersion = new Map(
    records.flatMap((record) =>
      record.repositoryId && record.versions[0]
        ? [[record.repositoryId, record.versions[0]] as const]
        : [],
    ),
  );
  return repositoryIds.flatMap((repositoryId) => {
    const repository = repositoryByVersion.get(repositoryId) ?? null;
    const persisted = composePersistedConfiguration(workspace, repository);
    return persisted ? [{ repositoryId, config: persisted }] : [];
  });
}

async function findLatestPolicyVersion(
  prisma: ReviewConfigurationPrismaClient,
  scope: { readonly workspaceId: string; readonly targetKey: string },
): Promise<VersionRecord | null> {
  const configuration = await prisma.reviewConfiguration.findUnique({
    where: {
      workspaceId_targetKey: {
        workspaceId: scope.workspaceId,
        targetKey: scope.targetKey,
      },
    },
    select: {
      active: true,
      repositoryId: true,
      versions: {
        orderBy: { version: "desc" },
        take: 1,
        select: versionSelect,
      },
    },
  });
  return configuration?.active ? (configuration.versions[0] ?? null) : null;
}

async function saveNextReviewConfigurationVersion(
  prisma: Prisma.TransactionClient,
  input: Parameters<ReviewConfigurationRepositoryPort["saveNextVersion"]>[0],
  operatorWorkspaceId?: string,
  receipt?: {
    readonly operationId: string;
    readonly operationIntentHash: string;
  },
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
      return matchOperationReceipt(
        prisma,
        target.workspaceId,
        original,
        receipt.operationIntentHash,
      );
  }
  const policy = parsePolicyForTarget(target, input.policy);
  const targetKey = reviewConfigurationTargetKey(target);
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

  const workspaceRecord =
    target.scope === "workspace"
      ? null
      : await findLatestPolicyVersion(prisma, {
          workspaceId: target.workspaceId,
          targetKey: "workspace:default",
        });
  const workspacePolicy =
    target.scope === "workspace"
      ? (policy as WorkspaceReviewPolicy)
      : workspaceRecord
        ? parseStoredPolicy("workspace", workspaceRecord.policyJson)
        : null;
  if (!workspacePolicy) throw new Error("review_workspace_policy_required");
  const repositoryPolicy =
    target.scope === "repository"
      ? (policy as RepositoryReviewPolicyOverride)
      : null;
  const effective = resolveReviewPolicy(workspacePolicy, repositoryPolicy);
  await assertGatewaySelections(
    prisma,
    target.workspaceId,
    effective,
    operatorWorkspaceId,
  );

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
      ...derivedPolicyProjection(effective),
      providers: {
        create: effective.providers.map((provider, index) => ({
          order: index,
          gatewayBindingId: provider.gatewayBindingId ?? null,
          gatewayProfileRef: provider.gatewayProfileRef ?? null,
          providerKind: provider.kind,
          providerAuthMode: provider.authMode,
          model: provider.model,
          reasoningEffort: provider.reasoningEffort,
          agenticContext: provider.agenticContext,
          fastMode: provider.fastMode,
          requiredHealthy: provider.requiredHealthy,
        })),
      },
    },
    select: versionSelect,
  });
  return composePersistedConfiguration(
    target.scope === "workspace" ? saved : workspaceRecord,
    target.scope === "repository" ? saved : null,
  )!;
}

async function deleteReviewConfigurationTarget(
  prisma: Prisma.TransactionClient,
  target: ReviewConfigurationTarget,
): Promise<boolean> {
  await acquireReviewConfigurationWriteScope(prisma, target);
  const scope = {
    workspaceId: target.workspaceId,
    targetKey: reviewConfigurationTargetKey(target),
  };
  const retained = await prisma.reviewConfiguration.updateMany({
    where: {
      ...scope,
      active: true,
      versions: { some: { operationId: { not: null } } },
    },
    data: { active: false },
  });
  const result = await prisma.reviewConfiguration.deleteMany({
    where: {
      ...scope,
      versions: { none: { operationId: { not: null } } },
    },
  });
  return retained.count + result.count > 0;
}

function parsePolicyForTarget(
  target: ReviewConfigurationTarget,
  policy: ReviewPolicySaveInput["policy"],
): WorkspaceReviewPolicy | RepositoryReviewPolicyOverride {
  return target.scope === "workspace"
    ? parseReviewConfigurationStrict(policy)
    : parseRepositoryReviewPolicyOverride(policy);
}

function parseStoredPolicy(
  scope: "workspace",
  policyJson: string | null,
): WorkspaceReviewPolicy | null;
function parseStoredPolicy(
  scope: "repository",
  policyJson: string | null,
): RepositoryReviewPolicyOverride | null;
function parseStoredPolicy(
  scope: "workspace" | "repository",
  policyJson: string | null,
): WorkspaceReviewPolicy | RepositoryReviewPolicyOverride | null {
  if (!policyJson) return null;
  try {
    const parsed = JSON.parse(policyJson);
    return scope === "workspace"
      ? parseReviewConfigurationStrict(parsed)
      : parseRepositoryReviewPolicyOverride(parsed);
  } catch {
    return null;
  }
}

function composePersistedConfiguration(
  workspace: VersionRecord | null,
  repository: VersionRecord | null,
): PersistedReviewConfiguration | null {
  if (
    !workspace ||
    workspace.schemaVersion !== 3 ||
    (repository && repository.schemaVersion !== 3)
  )
    return null;
  const workspacePolicy = workspace
    ? parseStoredPolicy("workspace", workspace.policyJson)
    : null;
  if (!workspacePolicy || workspacePolicy.schemaVersion !== 3) return null;
  const repositoryPolicy = repository
    ? parseStoredPolicy("repository", repository.policyJson)
    : null;
  if (repository && !repositoryPolicy) return null;
  const config = resolveReviewPolicy(workspacePolicy, repositoryPolicy);
  const digest = policyDigest(config);
  return {
    version: repository?.version ?? workspace?.version ?? 0,
    config,
    policy: repositoryPolicy ?? workspacePolicy,
    source: repositoryPolicy ? "repository" : "workspace",
    workspaceVersion: workspace?.version ?? null,
    repositoryVersion: repository?.version ?? null,
    effectivePolicyDigest: digest,
    revisionToken: `policy:${workspace?.version ?? 0}:${repository?.version ?? 0}:${digest}`,
  };
}

function policyDigest(config: ReviewConfiguration): string {
  return `sha256:${createHash("sha256").update(canonicalJson(config)).digest("hex")}`;
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

async function matchOperationReceipt(
  prisma: ReviewConfigurationPrismaClient,
  workspaceId: string,
  original: VersionRecord & { readonly operationIntentHash: string | null },
  intentHash: string,
): Promise<PersistedReviewConfiguration> {
  if (original.operationIntentHash !== intentHash) throw new WriteConflict();
  const workspace = original.repositoryId
    ? await findLatestPolicyVersion(prisma, {
        workspaceId,
        targetKey: "workspace:default",
      })
    : original;
  const persisted = composePersistedConfiguration(
    workspace,
    original.repositoryId ? original : null,
  );
  if (!persisted) throw new Error("review_configuration_receipt_invalid");
  return persisted;
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
    reasoningEffort: primary.reasoningEffort,
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

async function assertGatewaySelections(
  prisma: Prisma.TransactionClient,
  workspaceId: string,
  config: ReviewConfiguration,
  operatorWorkspaceId?: string,
): Promise<void> {
  for (const provider of config.providers) {
    if (provider.authMode !== "codex_account_gateway") continue;
    const binding = await prisma.workspaceAccountBinding.findUnique({
      where: { id_workspaceId: { id: provider.gatewayBindingId, workspaceId } },
      select: {
        state: true,
        pendingFenceOperationId: true,
        pendingFencePolicySubject: true,
        pendingFencePolicyRevision: true,
        connection: {
          select: {
            ownerWorkspaceId: true,
            ownerUserId: true,
            state: true,
            profileRef: true,
            ownerWorkspace: { select: { personalOwnerUserId: true } },
          },
        },
      },
    });
    if (
      !binding ||
      binding.state !== "active" ||
      binding.pendingFenceOperationId !== null ||
      binding.pendingFencePolicySubject !== null ||
      binding.pendingFencePolicyRevision !== null ||
      (binding.connection.ownerWorkspaceId !== workspaceId &&
        (operatorWorkspaceId === undefined ||
          binding.connection.ownerWorkspaceId !== operatorWorkspaceId)) ||
      binding.connection.ownerUserId !== null ||
      binding.connection.ownerWorkspace?.personalOwnerUserId !== null ||
      binding.connection.state !== "active"
    ) {
      throw new Error("review_configuration_gateway_binding_unavailable");
    }
    if (binding.connection.profileRef !== provider.gatewayProfileRef) {
      throw new Error("review_configuration_gateway_profile_mismatch");
    }
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
