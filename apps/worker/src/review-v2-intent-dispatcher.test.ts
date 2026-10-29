import { describe, expect, it, vi } from "vitest";
import {
  ReviewRequestAdmissionState,
  ReviewRequestedDispatchLookupStatus,
  ReviewRequestedDispatchRunStatus,
  ReviewRequestedDispatchSubmissionStatus,
  ReviewRequestedIntentState,
  ReviewRequestedIntentTerminalReason,
  ReviewRequestedTriggerKind,
  type ReviewRequestedIntent,
} from "@reviewrouter/features-review-executions";
import { GitHubActionsReviewRequestedDispatchGateway } from "./review-v2-intent-dispatcher";

describe("GitHubActionsReviewRequestedDispatchGateway", () => {
  it("reconciles an existing run before creating an external side effect", async () => {
    const request = vi.fn(async (route: string) => {
      expect(route).toContain("/workflows/");
      return {
        data: {
          workflow_runs: [
            {
              id: 701,
              run_attempt: 2,
              display_title: "ReviewRouter review request-1",
              created_at: "2026-07-23T00:00:01.000Z",
            },
          ],
        },
      };
    });
    const gateway = gatewayWith(request);

    await expect(
      gateway.findByRequestIdentity({ intent: intentFixture() }),
    ).resolves.toEqual({
      status: ReviewRequestedDispatchLookupStatus.Found,
      sourceRunId: "701",
      sourceRunAttempt: "2",
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("includes a run created in the same second as the durable submission", async () => {
    const request = vi.fn(async (_route: string, parameters?: object) => {
      expect(parameters).toMatchObject({
        created: ">=2026-07-23T00:00:00.000Z",
      });
      return {
        data: {
          workflow_runs: [
            {
              id: 700,
              run_attempt: 1,
              display_title: "ReviewRouter review request-1",
              created_at: "2026-07-23T00:00:00.000Z",
            },
          ],
        },
      };
    });
    const gateway = gatewayWith(request);

    await expect(
      gateway.findByRequestIdentity({
        intent: {
          ...intentFixture(),
          submissionStartedAt: new Date("2026-07-23T00:00:00.999Z"),
        },
      }),
    ).resolves.toMatchObject({
      status: ReviewRequestedDispatchLookupStatus.Found,
      sourceRunId: "700",
    });
  });

  it("requests exact run details and sends the durable request identity", async () => {
    const request = vi.fn(async (route: string, parameters?: object) => {
      if (route.startsWith("GET")) {
        return { data: pullRequestFixture() };
      }
      expect(route.startsWith("POST")).toBe(true);
      expect(parameters).toMatchObject({
        workflow_id: ".github/workflows/reviewrouter-review.yml",
        ref: "main",
        inputs: {
          review_request_id: "request-1",
          pr_number: "42",
          review_head_sha: "c".repeat(40),
        },
        headers: { "X-GitHub-Api-Version": "2026-03-10" },
      });
      return { data: { workflow_run_id: 702 } };
    });
    const gateway = gatewayWith(request);
    const prepared = await gateway.prepare({ intent: intentFixture() });

    await expect(prepared.submit()).resolves.toEqual({
      status: ReviewRequestedDispatchSubmissionStatus.Accepted,
      sourceRunId: "702",
      sourceRunAttempt: "1",
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("uses the stable repository control ref for a stacked pull request", async () => {
    const request = vi.fn(async (route: string, parameters?: object) => {
      if (route.startsWith("GET")) {
        return {
          data: {
            ...pullRequestFixture(),
            base: {
              ...pullRequestFixture().base,
              ref: "feature/stacked-base",
            },
          },
        };
      }
      expect(parameters).toMatchObject({ ref: "main" });
      return { data: { workflow_run_id: 703 } };
    });
    const prepared = await gatewayWith(request).prepare({
      intent: intentFixture(),
    });

    await expect(prepared.submit()).resolves.toMatchObject({
      status: ReviewRequestedDispatchSubmissionStatus.Accepted,
      sourceRunId: "703",
    });
  });

  it("fails closed before dispatch when the pull request revision changed", async () => {
    const request = vi.fn(async () => ({
      data: {
        ...pullRequestFixture(),
        head: {
          ...pullRequestFixture().head,
          sha: "9".repeat(40),
        },
      },
    }));
    const gateway = gatewayWith(request);

    await expect(gateway.prepare({ intent: intentFixture() })).rejects.toThrow(
      "review_requested_dispatch_revision_changed",
    );
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([
    ".github/workflows/reviewrouter-review.yml",
    ".github/workflows/reviewrouter-review.yml@main",
    ".github/workflows/reviewrouter-review.yml@release/control-v2",
  ])(
    "inspects the exact recorded attempt with workflow path %s",
    async (path) => {
      const request = vi.fn(async (route: string, parameters?: object) => {
        if (route.includes("/actions/runs/")) {
          expect(parameters).toMatchObject({ run_id: "701" });
          return {
            data: {
              id: 701,
              run_attempt: 2,
              event: "workflow_dispatch",
              display_title: "ReviewRouter review request-1",
              status: "completed",
              conclusion: "failure",
              path,
            },
          };
        }
        return {
          data: {
            head: { sha: "c".repeat(40) },
            base: { sha: "a".repeat(40) },
          },
        };
      });
      const gateway = gatewayWith(request);

      await expect(
        gateway.inspectKnownRun({
          intent: {
            ...intentFixture(),
            state: ReviewRequestedIntentState.AwaitingAuthorization,
            claim: null,
            sourceRunId: "701",
            sourceRunAttempt: "2",
          },
        }),
      ).resolves.toEqual({
        status: ReviewRequestedDispatchRunStatus.TerminalCurrentRevision,
      });
    },
  );

  // Regression: operator-cancelled runs were classified as retryable and the
  // recovery loop redispatched the same PR revision with a fresh request id.
  it.each(["cancelled", "skipped", "action_required", "success", null])(
    "does not offer a redispatch for a run concluded as %s",
    async (conclusion) => {
      const request = vi.fn(async (route: string) => {
        if (!route.includes("/actions/runs/"))
          throw new Error("pull_request_lookup_not_expected");
        return {
          data: {
            id: 701,
            run_attempt: 1,
            event: "workflow_dispatch",
            display_title: "ReviewRouter review request-1",
            status: "completed",
            conclusion,
            path: ".github/workflows/reviewrouter-review.yml",
          },
        };
      });

      await expect(
        gatewayWith(request).inspectKnownRun({
          intent: {
            ...intentFixture(),
            state: ReviewRequestedIntentState.AwaitingAuthorization,
            claim: null,
            sourceRunId: "701",
            sourceRunAttempt: "1",
          },
        }),
      ).resolves.toEqual({
        status: ReviewRequestedDispatchRunStatus.TerminalNotRetryable,
      });
      expect(request).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ReviewRequestedIntentTerminalReason.AuthorizationDeadlineExceeded,
    ReviewRequestedIntentTerminalReason.DispatchOutcomeUnknown,
  ])(
    "acknowledges owned terminal cleanup without a live PR lookup (%s)",
    async (terminalReason) => {
      const request = vi.fn(async (route: string) => {
        if (!route.includes("/actions/runs/"))
          throw new Error("pull_request_unavailable");
        return {
          data: {
            id: 701,
            run_attempt: 1,
            event: "workflow_dispatch",
            display_title: "ReviewRouter review request-1",
            status: "completed",
            path: ".github/workflows/reviewrouter-review.yml",
          },
        };
      });
      await expect(
        gatewayWith(request).inspectKnownRun({
          intent: {
            ...intentFixture(),
            state: ReviewRequestedIntentState.Terminal,
            terminalReason,
            sourceRunId: "701",
            sourceRunAttempt: "1",
          },
        }),
      ).resolves.toEqual({
        status: ReviewRequestedDispatchRunStatus.TerminalStaleRevision,
      });
      expect(request).toHaveBeenCalledTimes(1);
    },
  );

  it("classifies a validation rejection as definitely no external effect", async () => {
    const request = vi.fn(async (route: string) => {
      if (route.startsWith("GET")) {
        return { data: pullRequestFixture() };
      }
      throw Object.assign(new Error("unprocessable"), { status: 422 });
    });
    const gateway = gatewayWith(request);
    const prepared = await gateway.prepare({ intent: intentFixture() });

    await expect(prepared.submit()).resolves.toEqual({
      status: ReviewRequestedDispatchSubmissionStatus.DefinitelyNoEffect,
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("returns inconclusive when the bounded workflow inventory is exhausted", async () => {
    const request = vi.fn(async () => ({
      data: {
        workflow_runs: Array.from({ length: 100 }, (_, index) => ({
          id: index + 1,
          run_attempt: 1,
          display_title: `unrelated-${index}`,
          created_at: "2026-07-23T00:00:01.000Z",
        })),
      },
    }));
    const gateway = gatewayWith(request);

    await expect(
      gateway.findByRequestIdentity({ intent: intentFixture() }),
    ).resolves.toEqual({
      status: ReviewRequestedDispatchLookupStatus.Inconclusive,
    });
    expect(request).toHaveBeenCalledTimes(5);
  });

  it("fails closed when more than one run matches the request identity", async () => {
    const request = vi.fn(async () => ({
      data: {
        workflow_runs: [
          {
            id: 701,
            run_attempt: 1,
            display_title: "ReviewRouter review request-1",
            created_at: "2026-07-23T00:00:01.000Z",
          },
          {
            id: 702,
            run_attempt: 1,
            display_title: "ReviewRouter review request-1",
            created_at: "2026-07-23T00:00:02.000Z",
          },
        ],
      },
    }));
    const gateway = gatewayWith(request);

    await expect(
      gateway.findByRequestIdentity({ intent: intentFixture() }),
    ).resolves.toEqual({
      status: ReviewRequestedDispatchLookupStatus.Inconclusive,
    });
  });

  it.each([
    ".github/workflows/reviewrouter-review.yml",
    ".github/workflows/reviewrouter-review.yml@main",
  ])(
    "cancels only the exact persisted run identity with path %s",
    async (path) => {
      const request = vi.fn(async (route: string, parameters?: object) => {
        expect(parameters).toMatchObject({ run_id: "701" });
        if (route.startsWith("GET"))
          return {
            data: {
              id: 701,
              run_attempt: 2,
              event: "workflow_dispatch",
              display_title: "ReviewRouter review request-1",
              status: "queued",
              path,
            },
          };
        expect(route).toContain("/actions/runs/{run_id}/cancel");
        return { data: {} };
      });
      const gateway = gatewayWith(request);

      await expect(
        gateway.cancelKnownRun({
          intent: {
            ...intentFixture(),
            state: ReviewRequestedIntentState.AwaitingAuthorization,
            claim: null,
            sourceRunId: "701",
            sourceRunAttempt: "2",
          },
        }),
      ).resolves.toBeUndefined();
    },
  );
  it.each([
    { id: 702 },
    { event: "push" },
    { run_attempt: 3 },
    { display_title: "ReviewRouter review another-request" },
    { path: ".github/workflows/another-workflow.yml" },
    { path: ".github/workflows/another-workflow.yml@main" },
    { path: ".github/workflows/reviewrouter-review.yml@" },
    { path: ".github/workflows/reviewrouter-review.yml@../main" },
    { path: ".github/workflows/reviewrouter-review.yml@main\n" },
    { path: ".github/workflows/reviewrouter-review.yml@main.lock" },
    { path: ".github/workflows/reviewrouter-review.yml@refs/heads/main" },
    { path: null },
    { path: 1 },
  ])("refuses cancellation after run identity changes: %o", async (changed) => {
    const request = vi.fn(async () => ({
      data: {
        id: 701,
        run_attempt: 2,
        event: "workflow_dispatch",
        display_title: "ReviewRouter review request-1",
        status: "queued",
        path: ".github/workflows/reviewrouter-review.yml",
        ...changed,
      },
    }));
    await expect(
      gatewayWith(request).cancelKnownRun({
        intent: {
          ...intentFixture(),
          sourceRunId: "701",
          sourceRunAttempt: "2",
        },
      }),
    ).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  });
});

function gatewayWith(
  request: (
    route: string,
    parameters?: Readonly<Record<string, unknown>>,
  ) => Promise<{ readonly data: unknown }>,
) {
  const prisma = {
    repositoryConnection: {
      findUnique: vi.fn(async () => ({
        id: "connection-1",
        workspaceId: "workspace-1",
        scmRepositoryIdentityId: "repository-1",
        owner: "777genius",
        name: "agent-teams-ai",
        defaultBranch: "main",
        provider: "github",
        selected: true,
        archived: false,
        installation: { status: "active", githubInstallationId: 123n },
      })),
    },
  };
  return new GitHubActionsReviewRequestedDispatchGateway(
    prisma as never,
    { appId: "1", privateKey: "unused-in-test" },
    undefined,
    { forInstallation: async () => ({ request }) },
  );
}

function intentFixture(): ReviewRequestedIntent {
  const now = new Date("2026-07-23T00:00:00.000Z");
  return {
    workspaceId: "workspace-1",
    repositoryConnectionId: "connection-1",
    scmRepositoryIdentityId: "repository-1",
    pullRequestNumber: 42,
    requestId: "request-1",
    dispatchAttempt: 1,
    version: 3n,
    revision: {
      baseSha: "a".repeat(40),
      mergeBaseSha: "b".repeat(40),
      headSha: "c".repeat(40),
      reviewRevisionHash: "d".repeat(64),
    },
    triggerKind: ReviewRequestedTriggerKind.PullRequestSynchronized,
    deliveryIdentityHash: "e".repeat(64),
    canonicalRequestHash: "f".repeat(64),
    state: ReviewRequestedIntentState.ReconcilingDispatch,
    notBefore: now,
    claim: {
      claimId: "claim-1",
      ownerIdHash: "owner-1",
      fencingToken: 1n,
      claimedAt: now,
      claimUntil: new Date("2026-07-23T00:01:00.000Z"),
    },
    submissionStartedAt: now,
    nextResolutionAt: new Date("2026-07-23T00:00:05.000Z"),
    resolutionDeadlineAt: new Date("2026-07-23T00:05:00.000Z"),
    sourceRunId: null,
    sourceRunAttempt: null,
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
    createdAt: now,
    updatedAt: now,
    retainUntil: new Date("2026-08-23T00:00:00.000Z"),
  };
}

function pullRequestFixture() {
  return {
    state: "open",
    head: {
      sha: "c".repeat(40),
      repo: { full_name: "777genius/agent-teams-ai" },
    },
    base: {
      ref: "dev",
      sha: "a".repeat(40),
      repo: { full_name: "777genius/agent-teams-ai" },
    },
  };
}
