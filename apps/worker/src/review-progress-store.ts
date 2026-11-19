import { Prisma, type PrismaClient } from "@prisma/client";
import {
  persistInstallationCooldown,
  reserveInstallationBudgetMutation,
} from "./review-progress-installation-budget";
import { requeuePublishedScopeAfterClaimLoss } from "./review-progress-scope-repair";
import { claimDuePublication } from "./review-progress-claim-acquisition";
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
  /** Persisted repair marker observed when this claim was acquired. */
  lastErrorCode?: string | null;
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
  }): Promise<ClaimedReviewProgress | { readonly deferred: true } | null> {
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
    if (result.count !== 1) {
      if (input.repairOnFenceLoss === false) {
        // A no-write stale claim must not stop the maintenance pass when
        // cleanup fails. Its fenced lease will otherwise expire normally.
        await this.releaseOwnStaleNoWriteClaim(input.publication, input.now);
      } else {
        await this.requeueAfterClaimLoss({
          scope: input.publication.scope,
          now: input.now,
        });
      }
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
    if (result.count !== 1) {
      await this.releaseOwnStaleNoWriteClaim(input.publication, input.now);
    }
    return result.count === 1;
  }

  /** Do not leave an obsolete claim delaying a newer publishable version. */
  async releaseOwnStaleNoWriteClaim(
    publication: ClaimedReviewProgress,
    now: Date,
  ): Promise<void> {
    try {
      await this.prisma.reviewProgressPublicationV1.updateMany({
        where: {
          ...publication.scope,
          claimId: publication.claim.claimId,
          claimOwnerIdHash: publication.claim.ownerIdHash,
        },
        data: {
          claimId: null,
          claimOwnerIdHash: null,
          claimUntil: null,
          updatedAt: now,
        },
      });
    } catch {
      // A failed secondary cleanup is safe to defer until lease expiry.
      console.warn("review_progress_stale_claim_cleanup_failed");
    }
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

function assertOwner(value: string): void {
  if (!/^[a-f0-9]{64}$/.test(value))
    throw new Error("review_progress_owner_invalid");
}
function assertDuration(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error("review_progress_duration_invalid");
}
