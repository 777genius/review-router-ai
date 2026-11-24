import { describe, expect, it, vi } from "vitest";
import { githubProgressCommentMarker } from "@reviewrouter/features-review-progress";
import {
  ReviewRequestAdmissionState,
  ReviewRequestedIntentState,
  ReviewRequestedIntentTerminalReason,
  ReviewRequestedStartNotice,
  ReviewRequestedTriggerKind,
  type ReviewRequestedIntent,
} from "@reviewrouter/features-review-executions";
import { GitHubReviewRequestedStartNoticePublisher } from "./review-v2-start-notice-publisher";

const dispatchedAt = new Date("2026-11-21T10:00:00.000Z");
const now = new Date("2026-11-21T11:30:05.000Z");
const head = "c".repeat(40);

// Plan 88: the start notice is written into the pull request's one progress
// comment, only for a repository that live progress may write to, and only
// when the progress publication of the pull request is idle.
describe("GitHubReviewRequestedStartNoticePublisher", () => {
  it("rewrites the known progress comment with the not-started status", async () => {
    const f = fixture({ commentId: 501n });
    await expect(
      f.publish(ReviewRequestedStartNotice.NotStarted),
    ).resolves.toBe("published");
    const patch = f.calls.find(([route]) => route.startsWith("PATCH"));
    expect(patch?.[1]).toMatchObject({ comment_id: 501 });
    const body = String(patch?.[1]?.body);
    expect(body).toContain("**Phase:** Not started");
    expect(body).toContain("a runner within 90 minutes");
    expect(body).toContain(
      "re-run [the ReviewRouter run](https://github.com/777genius/social-monitor/actions/runs/701)",
    );
    expect(body).toContain("<!-- review-router-live-progress -->");
    expect(f.calls.some(([route]) => route.startsWith("POST"))).toBe(false);
  });

  it("writes the waiting status with the absolute end of the wait", async () => {
    const f = fixture({ commentId: 501n });
    await expect(
      f.publish(ReviewRequestedStartNotice.WaitingForRunner),
    ).resolves.toBe("published");
    const body = String(
      f.calls.find(([route]) => route.startsWith("PATCH"))?.[1]?.body,
    );
    expect(body).toContain("since 2026-11-21 10:00:00 UTC");
    expect(body).toContain("until about 2026-11-21 11:30:00 UTC");
  });

  it("skips a repository that live progress would not write to", async () => {
    const f = fixture({ commentId: 501n, repository: { selected: false } });
    await expect(
      f.publish(ReviewRequestedStartNotice.NotStarted),
    ).resolves.toBe("skipped");
    expect(f.calls).toEqual([]);
  });

  it("waits while live progress of the pull request is unpublished", async () => {
    const f = fixture({ commentId: 501n, unpublishedProgress: true });
    await expect(
      f.publish(ReviewRequestedStartNotice.NotStarted),
    ).resolves.toBe("busy");
    expect(f.calls).toEqual([]);
  });

  it("stays silent when the pull request moved, and retries when GitHub is down", async () => {
    const moved = fixture({ commentId: 501n, headOnGitHub: "e".repeat(40) });
    await expect(
      moved.publish(ReviewRequestedStartNotice.NotStarted),
    ).resolves.toBe("skipped");
    const down = fixture({ commentId: 501n, gitHubStatus: 502 });
    await expect(
      down.publish(ReviewRequestedStartNotice.NotStarted),
    ).resolves.toBe("busy");
  });
});

function fixture(options: {
  commentId: bigint | null;
  repository?: Partial<{ selected: boolean }>;
  unpublishedProgress?: boolean;
  headOnGitHub?: string;
  gitHubStatus?: number;
}) {
  const calls: Array<[string, Record<string, unknown> | undefined]> = [];
  const request = vi.fn(
    async (route: string, parameters?: Readonly<Record<string, unknown>>) => {
      calls.push([route, parameters as Record<string, unknown> | undefined]);
      if (options.gitHubStatus !== undefined) {
        throw Object.assign(new Error("github_unavailable"), {
          status: options.gitHubStatus,
          response: { headers: {}, data: {} },
        });
      }
      if (route === "GET /repos/{owner}/{repo}/pulls/{pull_number}") {
        return {
          data: {
            state: "open",
            head: { sha: options.headOnGitHub ?? head },
            base: { repo: { full_name: "777genius/social-monitor" } },
          },
        };
      }
      if (
        route === "GET /repos/{owner}/{repo}/issues/{issue_number}/comments"
      ) {
        return {
          data: [comment(`old progress\n\n${githubProgressCommentMarker}`)],
        };
      }
      if (route === "GET /repos/{owner}/{repo}/issues/comments/{comment_id}") {
        return {
          data: comment(`old progress\n\n${githubProgressCommentMarker}`),
        };
      }
      if (
        route === "PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}"
      ) {
        return { data: comment(String(parameters?.body)) };
      }
      throw new Error(`unexpected_route ${route}`);
    },
  );
  const prisma = {
    repositoryConnection: {
      findUnique: async () => ({
        workspaceId: "workspace-1",
        scmRepositoryIdentityId: "repository-1",
        selected: options.repository?.selected ?? true,
        archived: false,
        provider: "github",
        owner: "777genius",
        name: "social-monitor",
        fullName: "777genius/social-monitor",
        installation: { githubInstallationId: 9n, status: "active" },
      }),
    },
    $executeRaw: async () => 1,
    $transaction: async (operation: (transaction: unknown) => unknown) =>
      operation({
        $executeRaw: async () => 1,
        $queryRaw: async (query: { strings: readonly string[] }) =>
          query.strings.join(" ").includes("clock_timestamp()")
            ? [{ lockedAt: now }]
            : [],
        reviewProgressInstallationBudgetV1: {
          findUniqueOrThrow: async () => ({
            nextMutationAt: now,
            cooldownUntil: null,
          }),
          update: async () => ({}),
        },
        reviewProgressPublicationV1: {
          findUnique: async () => ({
            claimUntil: null,
            desiredVersion: options.unpublishedProgress ? 4n : 3n,
            publishedVersion: 3n,
            commentId: options.commentId,
          }),
        },
      }),
  };
  const publisher = new GitHubReviewRequestedStartNoticePublisher(
    prisma as never,
    async () => ({ request, botLogin: "reviewrouter[bot]" }),
    { now: () => now } as never,
    {
      allowedRepositoryFullNames: null,
      maxCommentPages: 5,
      minimumMutationIntervalMs: 1_000,
    },
  );
  return {
    calls,
    publish: (notice: ReviewRequestedStartNotice) =>
      publisher.publish({
        intent:
          notice === ReviewRequestedStartNotice.NotStarted
            ? notStarted()
            : waiting(),
        notice,
        runnerAssigned: false,
      }),
  };
}

function comment(body: string) {
  return {
    id: 501,
    body,
    user: { login: "reviewrouter[bot]" },
    issue_url:
      "https://api.github.com/repos/777genius/social-monitor/issues/42",
  };
}

function notStarted(): ReviewRequestedIntent {
  return {
    ...waiting(),
    state: ReviewRequestedIntentState.Terminal,
    nextResolutionAt: null,
    resolutionDeadlineAt: new Date(dispatchedAt.getTime() + 5_400_000),
    terminalReason:
      ReviewRequestedIntentTerminalReason.AuthorizationDeadlineExceeded,
  };
}

function waiting(): ReviewRequestedIntent {
  return {
    workspaceId: "workspace-1",
    repositoryConnectionId: "connection-1",
    scmRepositoryIdentityId: "repository-1",
    pullRequestNumber: 42,
    requestId: "request-1",
    historyRootRequestId: "request-1",
    dispatchAttempt: 1,
    version: 6n,
    revision: {
      baseSha: "a".repeat(40),
      mergeBaseSha: "b".repeat(40),
      headSha: head,
      reviewRevisionHash: "d".repeat(64),
    },
    triggerKind: ReviewRequestedTriggerKind.PullRequestSynchronized,
    deliveryIdentityHash: "e".repeat(64),
    canonicalRequestHash: "f".repeat(64),
    state: ReviewRequestedIntentState.AwaitingAuthorization,
    notBefore: dispatchedAt,
    claim: null,
    submissionStartedAt: dispatchedAt,
    nextResolutionAt: new Date(dispatchedAt.getTime() + 1_710_000),
    resolutionDeadlineAt: new Date(dispatchedAt.getTime() + 3_600_000),
    sourceRunId: "701",
    sourceRunAttempt: "1",
    authorizationId: null,
    executionId: null,
    terminalReason: null,
    admission: {
      state: ReviewRequestAdmissionState.NotEvaluated,
      changedLines: null,
      maxChangedLines: null,
      policySnapshotId: null,
      decisionHash: null,
      checkedAt: null,
    },
    rerunPredecessorRequestId: null,
    supersededByRequestId: null,
    createdAt: dispatchedAt,
    updatedAt: dispatchedAt,
    retainUntil: new Date(dispatchedAt.getTime() + 86_400_000),
  };
}
