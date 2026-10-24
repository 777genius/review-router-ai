import type { Prisma, PrismaClient } from "@prisma/client";
import {
  PrismaReviewPolicyHeadReader,
  resolveEffectiveReviewConfiguration,
  type ReviewPolicyReader,
} from "@reviewrouter/features-review-config";
import type {
  ActionHealthReport,
  ActionRepositoryContext,
  ActionSessionClaims,
} from "../../domain/action-control-plane.js";
import type {
  ActionControlPlaneRepositoryPort,
  RuntimeReviewConfigurationRecord,
} from "../../application/ports/action-control-plane-repository-port.js";

export class PrismaActionControlPlaneRepository implements ActionControlPlaneRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async findSelectedRepositoryByGithubId(
    githubRepositoryId: string,
  ): Promise<ActionRepositoryContext | null> {
    return this.prisma.$transaction(
      (transaction) =>
        this.findSelectedRepositoryByGithubIdSnapshot(
          transaction,
          githubRepositoryId,
        ),
      { isolationLevel: "RepeatableRead" },
    );
  }

  private async findSelectedRepositoryByGithubIdSnapshot(
    transaction: Prisma.TransactionClient,
    githubRepositoryId: string,
  ): Promise<ActionRepositoryContext | null> {
    const repository = await transaction.repositoryConnection.findFirst({
      where: {
        provider: "github",
        githubRepositoryId: BigInt(githubRepositoryId),
      },
      select: {
        id: true,
        workspaceId: true,
        githubRepositoryId: true,
        fullName: true,
        owner: true,
        selected: true,
        workspace: {
          select: {
            orgRulesets: {
              where: { status: "configured" },
              select: {
                scope: true,
                sourceGithubRepositoryId: true,
                sourceRepositoryFullName: true,
                sourceWorkflowPath: true,
                sourceWorkflowRef: true,
                targetRepositoryIds: true,
              },
            },
          },
        },
        provisioning: {
          where: { workflowStyle: "reusable" },
          orderBy: { updatedAt: "desc" },
          take: 10,
          select: {
            actionVersion: true,
            workflowStyle: true,
          },
        },
        installation: {
          select: { status: true, githubInstallationId: true },
        },
      },
    });

    if (
      !repository ||
      !repository.githubRepositoryId ||
      !repository.installation
    ) {
      return null;
    }
    const repositoryGithubId = repository.githubRepositoryId.toString();
    const identityBindings = await transaction.$queryRaw<
      Array<{ version: number; boundAt: Date }>
    >`
            SELECT identity."version", identity."boundAt"
            FROM "ScmRepositoryIdentity" identity
            WHERE identity."currentRepositoryConnectionId" = ${repository.id}
              AND identity."currentWorkspaceId" = ${repository.workspaceId}
              AND identity."externalRepositoryId" = ${repositoryGithubId}
              AND identity."boundAt" IS NOT NULL
              AND identity."unboundAt" IS NULL
          `;
    const identityBinding =
      identityBindings.length === 1 ? identityBindings[0] : undefined;

    return {
      workspaceId: repository.workspaceId,
      repositoryId: repository.id,
      githubRepositoryId: repositoryGithubId,
      githubInstallationId:
        repository.installation.githubInstallationId.toString(),
      fullName: repository.fullName,
      owner: repository.owner,
      ...(identityBinding
        ? {
            identityBindingEpoch: `${identityBinding.version}:${identityBinding.boundAt.toISOString()}`,
          }
        : {}),
      selected: repository.selected,
      trustedWorkflowRefs: [
        ...repository.workspace.orgRulesets
          .filter((ruleset) => {
            return orgRulesetTargetsRepository({
              scope: ruleset.scope,
              sourceGithubRepositoryId:
                ruleset.sourceGithubRepositoryId?.toString() ?? null,
              targetRepositoryIds: ruleset.targetRepositoryIds,
              githubRepositoryId: repositoryGithubId,
            });
          })
          .flatMap((ruleset) => {
            if (!ruleset.sourceRepositoryFullName) return [];
            return [
              `${ruleset.sourceRepositoryFullName}/${ruleset.sourceWorkflowPath}@${ruleset.sourceWorkflowRef}`,
            ];
          }),
        ...buildTrustedReusableWorkflowRefs(repository.provisioning),
      ],
      installationStatus: repository.installation.status,
    };
  }

  // Every consumer resolves one current policy; no legacy normalization path.
  async findRuntimeReviewConfiguration(
    input: {
      readonly workspaceId: string;
      readonly repositoryId: string;
    },
    reader: ReviewPolicyReader = this.prisma,
  ): Promise<RuntimeReviewConfigurationRecord | null> {
    const resolved = await resolveEffectiveReviewConfiguration(
      {
        scope: "repository",
        workspaceId: input.workspaceId,
        repositoryId: input.repositoryId,
      },
      {
        policyHeads:
          reader === this.prisma
            ? PrismaReviewPolicyHeadReader.snapshot(this.prisma)
            : new PrismaReviewPolicyHeadReader(reader),
      },
    );
    // No provider selected anywhere: callers answer review_provider_selection_required.
    if (resolved.status === "provider_selection_required") return null;
    if (resolved.status === "resave_required")
      throw new Error("review_policy_resave_required");
    return {
      source: resolved.source,
      version: resolved.version,
      workspaceVersion: resolved.workspaceVersion,
      repositoryVersion: resolved.repositoryVersion,
      effectivePolicyDigest: resolved.effectivePolicyDigest,
      config: resolved.config,
    };
  }

  async recordHealthReport(input: {
    readonly session: ActionSessionClaims;
    readonly report: ActionHealthReport;
    readonly receivedAt: Date;
  }): Promise<void> {
    const optionalData = {
      ...(input.report.safeErrorSummary
        ? { safeErrorSummary: input.report.safeErrorSummary }
        : {}),
      ...(input.report.startedAt
        ? { startedAt: new Date(input.report.startedAt) }
        : {}),
      ...(input.report.finishedAt
        ? { finishedAt: new Date(input.report.finishedAt) }
        : {}),
    };

    const data = {
      workspaceId: input.session.workspaceId,
      repositoryId: input.session.repositoryId,
      githubRunId: input.session.githubRunId,
      githubRunAttempt: input.session.githubRunAttempt,
      eventName: input.session.eventName,
      actionVersion: input.report.actionVersion,
      configVersion: input.report.configVersion,
      configSource: input.report.configSource ?? null,
      providerSetupState: input.report.providerSetupState,
      providerHealth: input.report.providerHealth,
      safeErrorCategory: input.report.safeErrorCategory,
      findingCriticalCount: input.report.findingCounts?.critical ?? null,
      findingMajorCount: input.report.findingCounts?.major ?? null,
      findingMinorCount: input.report.findingCounts?.minor ?? null,
      findingInfoCount: input.report.findingCounts?.info ?? null,
      inlineCommentCount: input.report.commentCounts?.inline ?? null,
      summaryCommentCount: input.report.commentCounts?.summary ?? null,
      skippedReasonCategory: input.report.skippedReasonCategory ?? null,
      receivedAt: input.receivedAt,
      ...optionalData,
    };

    await this.prisma.actionRunHealthReport.upsert({
      where: {
        repositoryId_githubRunId_githubRunAttempt: {
          repositoryId: input.session.repositoryId,
          githubRunId: input.session.githubRunId,
          githubRunAttempt: input.session.githubRunAttempt,
        },
      },
      update: {
        eventName: data.eventName,
        actionVersion: data.actionVersion,
        configVersion: data.configVersion,
        configSource: data.configSource,
        providerSetupState: data.providerSetupState,
        providerHealth: data.providerHealth,
        safeErrorCategory: data.safeErrorCategory,
        safeErrorSummary: data.safeErrorSummary ?? null,
        findingCriticalCount: data.findingCriticalCount,
        findingMajorCount: data.findingMajorCount,
        findingMinorCount: data.findingMinorCount,
        findingInfoCount: data.findingInfoCount,
        inlineCommentCount: data.inlineCommentCount,
        summaryCommentCount: data.summaryCommentCount,
        skippedReasonCategory: data.skippedReasonCategory,
        startedAt: data.startedAt ?? null,
        finishedAt: data.finishedAt ?? null,
        receivedAt: data.receivedAt,
      },
      create: {
        workspaceId: input.session.workspaceId,
        repositoryId: input.session.repositoryId,
        githubRunId: input.session.githubRunId,
        githubRunAttempt: input.session.githubRunAttempt,
        eventName: input.session.eventName,
        actionVersion: input.report.actionVersion,
        configVersion: input.report.configVersion,
        configSource: data.configSource,
        providerSetupState: input.report.providerSetupState,
        providerHealth: input.report.providerHealth,
        safeErrorCategory: input.report.safeErrorCategory,
        findingCriticalCount: data.findingCriticalCount,
        findingMajorCount: data.findingMajorCount,
        findingMinorCount: data.findingMinorCount,
        findingInfoCount: data.findingInfoCount,
        inlineCommentCount: data.inlineCommentCount,
        summaryCommentCount: data.summaryCommentCount,
        skippedReasonCategory: data.skippedReasonCategory,
        receivedAt: input.receivedAt,
        ...optionalData,
      },
    });
  }
}

export function orgRulesetTargetsRepository(input: {
  readonly scope: string;
  readonly sourceGithubRepositoryId: string | null;
  readonly targetRepositoryIds: unknown;
  readonly githubRepositoryId: string;
}): boolean {
  if (input.sourceGithubRepositoryId === input.githubRepositoryId) {
    return false;
  }
  if (input.scope === "all_repositories") return true;
  return parseTargetRepositoryIds(input.targetRepositoryIds).includes(
    input.githubRepositoryId,
  );
}

function parseTargetRepositoryIds(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item : String(item)))
    .filter(Boolean);
}

function buildTrustedReusableWorkflowRefs(
  provisioningRows: readonly {
    readonly actionVersion: string;
    readonly workflowStyle: string;
  }[],
): readonly string[] {
  const refs = new Set<string>();
  for (const row of provisioningRows) {
    if (row.workflowStyle !== "reusable") continue;
    const ref = extractReviewRouterRuntimeGitRef(row.actionVersion);
    if (!ref) continue;
    refs.add(
      `777genius/review-router/.github/workflows/reviewrouter-reusable.yml@${ref}`,
    );
    refs.add(
      `777genius/review-router/.github/workflows/reviewrouter-interaction-reusable.yml@${ref}`,
    );
  }
  return [...refs];
}

function extractReviewRouterRuntimeGitRef(
  actionVersion: string,
): string | null {
  const match = /^777genius\/review-router@(.+)$/.exec(actionVersion);
  if (!match) return null;
  const ref = match[1] ?? "";
  if (ref === "main") {
    return "refs/heads/main";
  }
  if (ref === "v1" || /^v1\.[0-9]+\.[0-9]+$/.test(ref)) {
    return `refs/tags/${ref}`;
  }
  if (/^[a-fA-F0-9]{40}$/.test(ref)) {
    return ref;
  }
  return null;
}
