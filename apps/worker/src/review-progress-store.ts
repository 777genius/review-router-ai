import { Prisma, type PrismaClient } from "@prisma/client";
import {
  persistInstallationCooldown,
  reserveInstallationBudgetMutation,
} from "./review-progress-installation-budget";
import { requeuePublishedScopeAfterClaimLoss } from "./review-progress-scope-repair";
import {
  claimPreparedPublication,
  selectDuePublicationScope,
} from "./review-progress-claim-acquisition";
import {
  loadMatchingActiveProgress,
  loadPublishableGitHubRepository,
} from "./review-progress-claim-readiness";
import {
  promoteSettledExecutions,
  type SettledExecutionInput,
} from "./review-progress-terminal-persistence";
import {
  completionMutationData,
  retryMutationData,
  safeCode,
} from "./review-progress-publication-mutation-policy";
import {
  claimedPublicationFence,
  repositoryCohortPredicate,
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
    /** False when the GitHub operation did not write the canonical comment body. */
    readonly repairOnFenceLoss?: boolean;
  }): Promise<boolean> {
    const result = await this.prisma.reviewProgressPublicationV1.updateMany({
      where: {
        ...claimedPublicationFence(input.publication),
      },
      data: completionMutationData(input),
    });
    if (result.count !== 1 && input.repairOnFenceLoss !== false) {
      await this.requeueAfterClaimLoss({
        scope: input.publication.scope,
        now: input.now,
      });
    }
    return result.count === 1;
  }

  /** Requeue an ambiguous GitHub write after its claim has gone stale. */
  async requeueAfterClaimLoss(input: {
    readonly scope: ClaimedReviewProgress["scope"];
    readonly now: Date;
  }): Promise<void> {
    await requeuePublishedScopeAfterClaimLoss(
      this.prisma,
      input.scope,
      input.now,
    );
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

  async promoteSettledExecutions(
    input: SettledExecutionInput,
  ): Promise<number> {
    return promoteSettledExecutions(this.prisma, input);
  }
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

function assertOwner(value: string): void {
  if (!/^[a-f0-9]{64}$/.test(value))
    throw new Error("review_progress_owner_invalid");
}
function assertDuration(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error("review_progress_duration_invalid");
}
