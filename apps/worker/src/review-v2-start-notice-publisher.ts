import { Prisma } from "@prisma/client";
import {
  formatGithubProgressNotStartedComment,
  formatGithubProgressWaitingForRunnerComment,
  githubProgressCommentMarker,
} from "@reviewrouter/features-review-progress";
import {
  ReviewRequestedStartNotice,
  reviewRequestedQueuedRunWaitLimit,
} from "@reviewrouter/features-review-executions";
import type { createPrismaClient } from "@reviewrouter/platform-db";
import type { Clock } from "@reviewrouter/shared";
import {
  ReviewProgressGitHubError,
  ReviewProgressGitHubGateway,
} from "./review-progress-github-gateway";
import { isPublishableGitHubRepository } from "./review-progress-claim-eligibility-policy";
import {
  persistInstallationCooldown,
  reserveProgressCommentNotice,
} from "./review-progress-installation-budget";
import type { ReviewProgressInstallationRequesterFactory } from "./review-progress-publisher";
import type {
  ReviewRequestedStartNoticePublisherPort,
  ReviewRequestedStartNoticePublication,
} from "./review-v2-start-notice-handler";

type PrismaClient = ReturnType<typeof createPrismaClient>;

/**
 * Writes a start notice into the pull request's one progress comment through
 * the same gateway, comment id and installation budget as live progress: the
 * gateway checks the PR head, finds the App's own comment and edits it in
 * place or creates it (plan 88).
 */
export class GitHubReviewRequestedStartNoticePublisher implements ReviewRequestedStartNoticePublisherPort {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly requestForInstallation: ReviewProgressInstallationRequesterFactory,
    private readonly clock: Clock,
    private readonly options: Readonly<{
      /** Lower-case `owner/repo` allow-list of progress comments, `null` for all. */
      allowedRepositoryFullNames: ReadonlySet<string> | null;
      maxCommentPages: number;
      minimumMutationIntervalMs: number;
    }>,
  ) {}

  async publish(
    input: ReviewRequestedStartNoticePublication,
  ): Promise<"published" | "skipped" | "busy"> {
    const intent = input.intent;
    const repository = await this.prisma.repositoryConnection.findUnique({
      where: { id: intent.repositoryConnectionId },
      select: {
        workspaceId: true,
        scmRepositoryIdentityId: true,
        selected: true,
        archived: true,
        provider: true,
        owner: true,
        name: true,
        fullName: true,
        installation: { select: { githubInstallationId: true, status: true } },
      },
    });
    if (
      !repository?.installation ||
      !isPublishableGitHubRepository(
        repository,
        repository.installation.status,
        intent,
      ) ||
      (this.options.allowedRepositoryFullNames !== null &&
        !this.options.allowedRepositoryFullNames.has(
          repository.fullName.toLowerCase(),
        ))
    ) {
      return "skipped";
    }
    const installationId = repository.installation.githubInstallationId;
    const body = this.render(input, repository);
    const reservation = await this.prisma.$transaction(
      (transaction) =>
        reserveProgressCommentNotice(transaction, {
          scope: {
            workspaceId: intent.workspaceId,
            repositoryConnectionId: intent.repositoryConnectionId,
            scmRepositoryIdentityId: intent.scmRepositoryIdentityId,
            pullRequestNumber: intent.pullRequestNumber,
          },
          installationId,
          // The live publisher never writes more often than once a second.
          minimumIntervalMs: Math.max(
            1_000,
            this.options.minimumMutationIntervalMs,
          ),
        }),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    if (!reservation.allowed) return "busy";
    const installation = await this.requestForInstallation(installationId);
    try {
      await new ReviewProgressGitHubGateway(installation.request, {
        maxCommentPages: this.options.maxCommentPages,
        now: () => this.clock.now(),
      }).upsert({
        owner: repository.owner,
        repo: repository.name,
        pullNumber: intent.pullRequestNumber,
        expectedHeadSha: intent.revision.headSha,
        expectedBotLogin: installation.botLogin,
        ...(reservation.commentId === null
          ? {}
          : { knownCommentId: Number(reservation.commentId) }),
        marker: githubProgressCommentMarker,
        body,
      });
      return "published";
    } catch (error) {
      if (!(error instanceof ReviewProgressGitHubError)) throw error;
      const cooldownUntil = error.metadata.installationCooldownUntil;
      if (cooldownUntil !== undefined) {
        await persistInstallationCooldown(
          this.prisma,
          installationId,
          cooldownUntil,
          this.clock.now(),
        );
      }
      // A moved or closed pull request, another repository or a revoked App
      // cannot take this status; a retryable GitHub failure is tried again.
      return error.metadata.retryable ? "busy" : "skipped";
    }
  }

  private render(
    input: ReviewRequestedStartNoticePublication,
    repository: { readonly owner: string; readonly name: string },
  ): string {
    const intent = input.intent;
    const updatedAt = this.clock.now().toISOString();
    if (input.notice === ReviewRequestedStartNotice.WaitingForRunner) {
      return formatGithubProgressWaitingForRunnerComment({
        headSha: intent.revision.headSha,
        queuedSince: requiredDate(intent.submissionStartedAt).toISOString(),
        queuedUntil: requiredDate(
          reviewRequestedQueuedRunWaitLimit(intent),
        ).toISOString(),
        updatedAt,
      });
    }
    const sourceRunId = intent.sourceRunId;
    if (sourceRunId === null || !/^[1-9][0-9]*$/u.test(sourceRunId)) {
      throw new Error("review_start_notice_run_missing");
    }
    return formatGithubProgressNotStartedComment({
      headSha: intent.revision.headSha,
      waitedMinutes: Math.max(
        1,
        Math.round(
          (requiredDate(intent.resolutionDeadlineAt).getTime() -
            requiredDate(intent.submissionStartedAt).getTime()) /
            60_000,
        ),
      ),
      runnerAssigned: input.runnerAssigned,
      runUrl: `https://github.com/${repository.owner}/${repository.name}/actions/runs/${sourceRunId}`,
      updatedAt,
    });
  }
}

function requiredDate(value: Date | null): Date {
  if (value === null) throw new Error("review_start_notice_window_missing");
  return value;
}
