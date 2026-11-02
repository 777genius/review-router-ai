import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  ReviewPublicationDueWork,
  ReviewPublicationWorkFeedPort,
} from "../../application/ports/review-publication-work-feed-port";

export class PrismaReviewPublicationWorkFeed implements ReviewPublicationWorkFeedPort {
  constructor(
    private readonly prisma: Pick<
      PrismaClient,
      "$queryRaw" | "reviewPublicationOperationV2"
    >,
  ) {}

  async scan(input: {
    readonly now: Date;
    readonly limit: number;
  }): Promise<readonly ReviewPublicationDueWork[]> {
    if (!Number.isSafeInteger(input.limit) || input.limit < 0) {
      throw new Error("review_publication_work_limit_invalid");
    }
    if (!Number.isFinite(input.now.getTime())) {
      throw new Error("review_publication_work_time_invalid");
    }
    if (input.limit === 0) return [];

    // Bound eligible work, rather than an oversampled prefix that may consist
    // entirely of expired attempts. This read is not a claim or authorization.
    return this.prisma.$queryRaw<ReviewPublicationDueWork[]>(Prisma.sql`
      SELECT
        operation."publicationOperationId",
        operation."publicationAttemptId",
        operation."retryCount",
        attempt."executionId",
        repository."provider"
      FROM "ReviewPublicationOperationV2" operation
      JOIN "ReviewPublicationAttemptV2" attempt
        ON attempt."publicationAttemptId" = operation."publicationAttemptId"
      JOIN "RepositoryConnection" repository
        ON repository."id" = attempt."repositoryConnectionId"
        AND repository."workspaceId" = attempt."workspaceId"
        AND repository."scmRepositoryIdentityId" = attempt."scmRepositoryIdentityId"
      WHERE operation."state" IN ('planned', 'in_flight', 'effect_observed', 'reconciling')
        AND operation."nextEligibleAt" <= ${input.now}
        AND attempt."state" IN ('pending', 'publishing', 'reconciling')
        AND attempt."retainUntil" > ${input.now}
        AND repository."provider" IN ('github', 'gitlab')
      ORDER BY
        operation."required" DESC,
        operation."nextEligibleAt" ASC,
        operation."reconcileUntil" ASC,
        operation."publicationOperationId" ASC
      LIMIT ${Math.min(input.limit, 1_000)}
    `);
  }

  async defer(input: {
    readonly work: ReviewPublicationDueWork;
    readonly nextEligibleAt: Date;
    readonly lastErrorCode: string;
  }): Promise<void> {
    const updated = await this.prisma.reviewPublicationOperationV2.updateMany({
      where: {
        publicationOperationId: input.work.publicationOperationId,
        publicationAttemptId: input.work.publicationAttemptId,
        retryCount: input.work.retryCount,
        state: {
          in: ["planned", "in_flight", "effect_observed", "reconciling"],
        },
      },
      data: {
        retryCount: { increment: 1 },
        nextEligibleAt: input.nextEligibleAt,
        lastErrorCode: input.lastErrorCode,
      },
    });
    if (updated.count > 1) {
      throw new Error("review_v2_publication_retry_cas_invalid");
    }
  }
}
