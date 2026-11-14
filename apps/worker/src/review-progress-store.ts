import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  persistInstallationCooldown,
  reserveInstallationBudgetMutation,
} from "./review-progress-installation-budget";
import { promoteSettledExecution } from "./review-progress-terminal-persistence";
import {
  completionMutationData,
  retryMutationData,
  safeCode,
} from "./review-progress-publication-mutation-policy";
import {
  claimedPublicationFence,
  isPublishableGitHubRepository,
  matchesActiveProgressIdentity,
} from "./review-progress-claim-eligibility-policy";

export type ClaimedReviewProgress = Readonly<{
  scope: Readonly<{
    workspaceId: string;
    repositoryConnectionId: string;
    scmRepositoryIdentityId: string;
    pullRequestNumber: number;
  }>;
  executionId: string;
  generation: bigint;
  headSha: string;
  planHash: string;
  desiredVersion: bigint;
  publishedVersion: bigint;
  commentId: bigint | null;
  publishedBodyHash: string | null;
  failureCount: number;
  snapshot: unknown;
  terminal: boolean;
  repository: Readonly<{
    owner: string;
    name: string;
    githubInstallationId: bigint;
  }>;
  claim: Readonly<{
    claimId: string;
    ownerIdHash: string;
    claimUntil: Date;
  }>;
}>;

export class PrismaReviewProgressPublicationStore {
  private readonly allowedRepositoryFullNames: ReadonlySet<string> | null;

  constructor(
    private readonly prisma: PrismaClient,
    options: {
      readonly allowedRepositoryFullNames?: ReadonlySet<string> | null;
    } = {},
  ) {
    this.allowedRepositoryFullNames =
      options.allowedRepositoryFullNames === undefined
        ? null
        : options.allowedRepositoryFullNames;
  }

  async claimNext(input: {
    readonly ownerIdHash: string;
    readonly now: Date;
    readonly claimDurationMs: number;
  }): Promise<ClaimedReviewProgress | null> {
    assertOwner(input.ownerIdHash);
    assertDuration(input.claimDurationMs);
    const repositoryPredicate = repositoryCohortPredicate(
      this.allowedRepositoryFullNames,
    );
    return this.prisma.$transaction(
      (transaction) =>
        claimDuePublication(transaction, input, repositoryPredicate),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async reserveInstallationMutation(input: {
    readonly publication: ClaimedReviewProgress;
    readonly now: Date;
    readonly minimumIntervalMs: number;
  }): Promise<{ allowed: true } | { allowed: false; retryAt: Date }> {
    assertDuration(input.minimumIntervalMs);
    return this.prisma.$transaction(
      (transaction) => reserveInstallationBudgetMutation(transaction, input),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async complete(input: {
    readonly publication: ClaimedReviewProgress;
    readonly commentId: bigint;
    readonly bodyHash: string;
    readonly now: Date;
  }): Promise<boolean> {
    const result = await this.prisma.reviewProgressPublicationV1.updateMany({
      where: {
        ...claimedPublicationFence(input.publication),
      },
      data: completionMutationData(input),
    });
    return result.count === 1;
  }

  async retry(input: {
    readonly publication: ClaimedReviewProgress;
    readonly safeCode: string;
    readonly retryAt: Date;
    readonly installationCooldownUntil?: Date | undefined;
    readonly now: Date;
    readonly maxFailures: number;
    readonly countFailure?: boolean | undefined;
  }): Promise<"retried" | "suppressed" | "stale"> {
    assertDuration(input.maxFailures);
    return this.prisma.$transaction((transaction) =>
      retryPublicationMutation(transaction, input),
    );
  }

  async suppress(input: {
    readonly publication: ClaimedReviewProgress;
    readonly safeCode: string;
    readonly now: Date;
  }): Promise<boolean> {
    const result = await this.prisma.reviewProgressPublicationV1.updateMany({
      where: {
        ...claimedPublicationFence(input.publication),
      },
      data: {
        publishedVersion: input.publication.desiredVersion,
        claimId: null,
        claimOwnerIdHash: null,
        claimUntil: null,
        lastErrorCode: safeCode(input.safeCode),
        updatedAt: input.now,
      },
    });
    return result.count === 1;
  }

  async promoteSettledExecutions(input: {
    readonly settlements: readonly Readonly<{
      executionId: string;
      outcome: "succeeded" | "failed" | "superseded";
    }>[];
    readonly now: Date;
  }): Promise<number> {
    let promoted = 0;
    const failures: unknown[] = [];
    const executionIds = new Set(input.settlements.map((s) => s.executionId));
    for (const executionId of executionIds) {
      try {
        const changed = await this.prisma.$transaction(
          (transaction) =>
            promoteSettledExecution(transaction, executionId, input.now),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        if (changed) promoted += 1;
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(failures, "review_progress_settlements_failed");
    }
    return promoted;
  }
}

/** Build the optional hosted repository cohort fence outside claim orchestration. */
function repositoryCohortPredicate(
  allowedRepositoryFullNames: ReadonlySet<string> | null,
): Prisma.Sql {
  if (!allowedRepositoryFullNames) return Prisma.empty;
  // An explicitly empty cohort must reject all claims without Prisma.join([]).
  if (allowedRepositoryFullNames.size === 0) return Prisma.sql`AND FALSE`;
  return Prisma.sql`
          AND EXISTS (
            SELECT 1 FROM "RepositoryConnection" repository
            WHERE repository."id" = publication."repositoryConnectionId"
              AND LOWER(repository."fullName") IN (${Prisma.join([
                ...allowedRepositoryFullNames,
              ])})
          )`;
}

/** Persist retry and installation cooldown inside the same transaction. */
async function retryPublicationMutation(
  transaction: Prisma.TransactionClient,
  input: Parameters<PrismaReviewProgressPublicationStore["retry"]>[0],
): Promise<"retried" | "suppressed" | "stale"> {
  const mutation = retryMutationData(input);
  const updated = await transaction.reviewProgressPublicationV1.updateMany({
    where: {
      ...claimedPublicationFence(input.publication),
    },
    data: mutation.data,
  });
  if (input.installationCooldownUntil) {
    await persistInstallationCooldown(
      transaction,
      input.publication.repository.githubInstallationId,
      input.installationCooldownUntil,
      input.now,
    );
  }
  if (updated.count !== 1) return "stale";
  return mutation.reachesLimit ? "suppressed" : "retried";
}

/** Select one due publication scope under the existing row lock and priority policy. */
async function selectDuePublicationScope(
  transaction: Prisma.TransactionClient,
  now: Date,
  repositoryPredicate: Prisma.Sql,
): Promise<ClaimedReviewProgress["scope"] | null> {
  const rows = await transaction.$queryRaw<
    Array<ClaimedReviewProgress["scope"]>
  >(Prisma.sql`
  SELECT publication."workspaceId", publication."repositoryConnectionId",
    publication."scmRepositoryIdentityId", publication."pullRequestNumber"
  FROM "ReviewProgressPublicationV1" publication
  WHERE publication."desiredVersion" > publication."publishedVersion"
    AND publication."nextPublishAt" <= ${now}
    AND (publication."claimUntil" IS NULL OR publication."claimUntil" <= ${now})
    ${repositoryPredicate}
  ORDER BY
    CASE WHEN EXISTS (
      SELECT 1 FROM "ReviewExecutionProgressV1" progress
      WHERE progress."executionId" = publication."activeExecutionId"
        AND progress."terminalOutcome" IS NOT NULL
    ) THEN 0 ELSE 1 END,
    publication."nextPublishAt", publication."updatedAt"
  LIMIT 1
  FOR UPDATE SKIP LOCKED
`);
  return rows[0] ?? null;
}

/** Claim the next due projection under the same serializable transaction. */
async function claimDuePublication(
  transaction: Prisma.TransactionClient,
  input: Parameters<PrismaReviewProgressPublicationStore["claimNext"]>[0],
  repositoryPredicate: Prisma.Sql,
): Promise<ClaimedReviewProgress | null> {
  const candidate = await selectDuePublicationScope(
    transaction,
    input.now,
    repositoryPredicate,
  );
  if (!candidate) return null;
  const publication =
    await transaction.reviewProgressPublicationV1.findUniqueOrThrow({
      where: {
        workspaceId_repositoryConnectionId_scmRepositoryIdentityId_pullRequestNumber:
          candidate,
      },
    });
  const progress = await loadMatchingActiveProgress(
    transaction,
    publication,
    candidate,
    input.now,
  );
  if (!progress) return null;
  const eligible = await loadPublishableGitHubRepository(
    transaction,
    publication,
    candidate,
    input.now,
  );
  if (!eligible) return null;
  return claimPreparedPublication(
    transaction,
    input,
    candidate,
    publication,
    progress,
    eligible.repository,
    eligible.installation,
  );
}

/** Resolve active progress and defer an invalid generation before repository lookup. */
async function loadMatchingActiveProgress(
  transaction: Prisma.TransactionClient,
  publication: {
    readonly activeExecutionId: string;
    readonly activeGeneration: bigint;
    readonly activeHeadSha: string;
    readonly activePlanHash: string;
    readonly desiredVersion: bigint;
  },
  scope: ClaimedReviewProgress["scope"],
  now: Date,
) {
  const progress = await transaction.reviewExecutionProgressV1.findUnique({
    where: { executionId: publication.activeExecutionId },
  });
  if (!progress || !matchesActiveProgressIdentity(progress, publication)) {
    await deferUnavailablePublication(
      transaction,
      scope,
      now,
      "review_progress_projection_identity_corrupted",
    );
    return null;
  }
  return progress;
}

/** Check GitHub repository eligibility before writing the publication claim. */
async function loadPublishableGitHubRepository(
  transaction: Prisma.TransactionClient,
  publication: {
    readonly repositoryConnectionId: string;
    readonly workspaceId: string;
    readonly scmRepositoryIdentityId: string;
  },
  scope: ClaimedReviewProgress["scope"],
  now: Date,
) {
  const repository = await transaction.repositoryConnection.findUnique({
    where: { id: publication.repositoryConnectionId },
    include: {
      installation: {
        select: { githubInstallationId: true, status: true },
      },
    },
  });
  if (
    !repository ||
    !repository.installation ||
    !isPublishableGitHubRepository(
      repository,
      repository.installation.status,
      publication,
    )
  ) {
    await deferUnavailablePublication(
      transaction,
      scope,
      now,
      "review_progress_github_repository_unavailable",
    );
    return null;
  }
  return { repository, installation: repository.installation };
}

/** Persist the fenced claim and construct its owned publication projection. */
async function claimPreparedPublication(
  transaction: Prisma.TransactionClient,
  input: Parameters<PrismaReviewProgressPublicationStore["claimNext"]>[0],
  candidate: ClaimedReviewProgress["scope"],
  publication: {
    readonly publishedVersion: bigint;
    readonly commentId: bigint | null;
    readonly publishedBodyHash: string | null;
    readonly failureCount: number;
  },
  progress: {
    readonly executionId: string;
    readonly generation: bigint;
    readonly headSha: string;
    readonly planHash: string;
    readonly desiredVersion: bigint;
    readonly snapshotJson: unknown;
    readonly terminalOutcome: string | null;
  },
  repository: {
    readonly owner: string;
    readonly name: string;
  },
  installation: { readonly githubInstallationId: bigint },
): Promise<ClaimedReviewProgress> {
  const claimId = randomUUID();
  const claimUntil = new Date(input.now.getTime() + input.claimDurationMs);
  await transaction.reviewProgressPublicationV1.update({
    where: {
      workspaceId_repositoryConnectionId_scmRepositoryIdentityId_pullRequestNumber:
        candidate,
    },
    data: { claimId, claimOwnerIdHash: input.ownerIdHash, claimUntil },
  });
  return buildClaimedReviewProgress({
    candidate,
    publication,
    progress,
    repository,
    installation,
    claim: { claimId, ownerIdHash: input.ownerIdHash, claimUntil },
  });
}

/** Build the publication snapshot only after its claim was persisted. */
function buildClaimedReviewProgress(input: {
  readonly candidate: ClaimedReviewProgress["scope"];
  readonly publication: Parameters<typeof claimPreparedPublication>[3];
  readonly progress: Parameters<typeof claimPreparedPublication>[4];
  readonly repository: Parameters<typeof claimPreparedPublication>[5];
  readonly installation: Parameters<typeof claimPreparedPublication>[6];
  readonly claim: ClaimedReviewProgress["claim"];
}): ClaimedReviewProgress {
  const { candidate, publication, progress, repository, installation, claim } =
    input;
  return {
    scope: candidate,
    executionId: progress.executionId,
    generation: progress.generation,
    headSha: progress.headSha,
    planHash: progress.planHash,
    desiredVersion: progress.desiredVersion,
    publishedVersion: publication.publishedVersion,
    commentId: publication.commentId,
    publishedBodyHash: publication.publishedBodyHash,
    failureCount: publication.failureCount,
    snapshot: progress.snapshotJson,
    terminal: progress.terminalOutcome !== null,
    repository: {
      owner: repository.owner,
      name: repository.name,
      githubInstallationId: installation.githubInstallationId,
    },
    claim,
  };
}

async function deferUnavailablePublication(
  transaction: Prisma.TransactionClient,
  scope: {
    workspaceId: string;
    repositoryConnectionId: string;
    scmRepositoryIdentityId: string;
    pullRequestNumber: number;
  },
  now: Date,
  code: string,
): Promise<void> {
  await transaction.reviewProgressPublicationV1.update({
    where: {
      workspaceId_repositoryConnectionId_scmRepositoryIdentityId_pullRequestNumber:
        scope,
    },
    data: {
      failureCount: { increment: 1 },
      lastErrorCode: code,
      nextPublishAt: new Date(now.getTime() + 60_000),
      updatedAt: now,
    },
  });
}

function assertOwner(value: string): void {
  if (!/^[a-f0-9]{64}$/.test(value))
    throw new Error("review_progress_owner_invalid");
}
function assertDuration(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error("review_progress_duration_invalid");
}
