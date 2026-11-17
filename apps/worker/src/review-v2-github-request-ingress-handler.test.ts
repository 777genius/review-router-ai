import { describe, expect, it, vi } from "vitest";
import {
  GitHubReviewRequestIngressCommandKind,
  GitHubReviewRequestTriggerAction,
  githubReviewRequestIngressEventType,
  githubReviewRequestIngressEventVersion,
} from "@reviewrouter/features-github-installations";
import {
  ReviewRequestIngressCommandKind,
  ReviewRequestedTriggerKind,
} from "@reviewrouter/features-review-executions";
import {
  ReviewMutationLaneKind,
  ReviewMutationMode,
} from "@reviewrouter/features-review-run-control";
import type { OutboxEvent } from "@reviewrouter/features-outbox";
import { createGitHubReviewRequestIngressHandler } from "./review-v2-github-request-ingress-handler";

const now = new Date("2026-07-23T10:00:00.000Z");

describe("GitHub review request ingress handler", () => {
  it("resolves internal scope in the worker before registering the request", async () => {
    const execute = vi.fn(async () => undefined);
    const authorities = authorityGateway(ReviewMutationMode.V2Active);
    const handler = createGitHubReviewRequestIngressHandler({
      repositories: repositoryGateway(),
      identities: identityGateway(),
      authorities,
      application: { execute } as never,
      readyQuietPeriodMs: 15_000,
      draftQuietPeriodMs: 45_000,
      retentionMs: 86_400_000,
    });

    await handler.handle(event());

    expect(execute).toHaveBeenCalledWith({
      occurredAt: now,
      payload: expect.objectContaining({
        commandKind: ReviewRequestIngressCommandKind.Request,
        workspaceId: "workspace-1",
        repositoryConnectionId: "connection-1",
        scmRepositoryIdentityId: "repository-1",
        requestId: `review-request-${"d".repeat(64)}`,
        triggerKind: ReviewRequestedTriggerKind.PullRequestSynchronized,
        quietPeriodMs: 15_000,
      }),
    });
    expect(authorities.findReviewMutationAuthority).toHaveBeenCalledWith({
      scmRepositoryIdentityId: "repository-1",
      laneKind: ReviewMutationLaneKind.HostedReviewRouterApp,
    });
  });

  // Production regression: repositories with the managed workflow but a
  // v1_open or missing hosted lane were dispatched and every run was refused
  // with review_run_authorize:mutation_authority_unavailable.
  it.each([
    ["missing", null],
    ["v1_open", ReviewMutationMode.V1Open],
    ["v1_draining", ReviewMutationMode.V1Draining],
    ["paused", ReviewMutationMode.Paused],
  ] as const)(
    "ignores a request when the hosted lane authority is %s",
    async (_label, mode) => {
      const execute = vi.fn(async () => undefined);
      const handler = createGitHubReviewRequestIngressHandler({
        repositories: repositoryGateway(),
        identities: identityGateway(),
        authorities: authorityGateway(mode),
        application: { execute } as never,
        readyQuietPeriodMs: 15_000,
        draftQuietPeriodMs: 45_000,
        retentionMs: 86_400_000,
      });

      await handler.handle(event());

      expect(execute).not.toHaveBeenCalled();
    },
  );

  it("still forwards a cancellation without an active hosted lane", async () => {
    const execute = vi.fn(async () => undefined);
    const authorities = authorityGateway(null);
    const handler = createGitHubReviewRequestIngressHandler({
      repositories: repositoryGateway(),
      identities: identityGateway(),
      authorities,
      application: { execute } as never,
      readyQuietPeriodMs: 15_000,
      draftQuietPeriodMs: 45_000,
      retentionMs: 86_400_000,
    });

    await handler.handle(
      event({ commandKind: GitHubReviewRequestIngressCommandKind.Cancel }),
    );

    expect(execute).toHaveBeenCalledWith({
      occurredAt: now,
      payload: expect.objectContaining({
        commandKind: ReviewRequestIngressCommandKind.Cancel,
      }),
    });
    expect(authorities.findReviewMutationAuthority).not.toHaveBeenCalled();
  });

  it("retries an unavailable authority read instead of dropping the request", async () => {
    const execute = vi.fn(async () => undefined);
    const handler = createGitHubReviewRequestIngressHandler({
      repositories: repositoryGateway(),
      identities: identityGateway(),
      authorities: {
        findReviewMutationAuthority: vi.fn(async () => {
          throw new Error("database unavailable");
        }),
      },
      application: { execute } as never,
      readyQuietPeriodMs: 15_000,
      draftQuietPeriodMs: 45_000,
      retentionMs: 86_400_000,
    });

    await expect(handler.handle(event())).rejects.toMatchObject({
      code: "review_request_authority_unavailable",
      retryable: true,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("retries repository projection lag instead of acknowledging it as ignored", async () => {
    const handler = createGitHubReviewRequestIngressHandler({
      repositories: {
        findSelectedRepositoryByGithubId: async () => null,
      } as never,
      identities: identityGateway(),
      authorities: authorityGateway(ReviewMutationMode.V2Active),
      application: { execute: vi.fn() } as never,
      readyQuietPeriodMs: 15_000,
      draftQuietPeriodMs: 45_000,
      retentionMs: 86_400_000,
    });

    await expect(handler.handle(event())).rejects.toMatchObject({
      code: "review_request_repository_projection_unavailable",
      retryable: true,
    });
  });
});

function repositoryGateway() {
  return {
    findSelectedRepositoryByGithubId: async () => ({
      workspaceId: "workspace-1",
      repositoryId: "connection-1",
      githubRepositoryId: "99",
      githubInstallationId: "123",
      fullName: "777genius/agent-teams-ai",
      owner: "777genius",
      selected: true,
      installationStatus: "active",
    }),
  } as never;
}

function identityGateway() {
  return {
    findScmRepositoryIdentityById: async () => null,
    findScmRepositoryIdentityByExternalIdentity: async () => ({
      scmRepositoryIdentityId: "repository-1",
      currentWorkspaceId: "workspace-1",
      currentRepositoryConnectionId: "connection-1",
    }),
  } as never;
}

function authorityGateway(mode: ReviewMutationMode | null) {
  return {
    findReviewMutationAuthority: vi.fn(async () =>
      mode === null
        ? null
        : ({
            scmRepositoryIdentityId: "repository-1",
            laneKind: ReviewMutationLaneKind.HostedReviewRouterApp,
            mode,
          } as never),
    ),
  };
}

function event(options?: {
  readonly commandKind?: GitHubReviewRequestIngressCommandKind;
}): OutboxEvent {
  const common = {
    protocolVersion: 1,
    deliveryIdentityHash: "d".repeat(64),
    githubInstallationId: "123",
    githubRepositoryId: "99",
    repositoryFullName: "777genius/agent-teams-ai",
    pullRequestNumber: 42,
  };
  return {
    id: "outbox-external-1",
    type: githubReviewRequestIngressEventType,
    version: githubReviewRequestIngressEventVersion,
    idempotencyKey: "github-review-request",
    workspaceId: null,
    repositoryId: null,
    aggregateId: "github-scope",
    payload:
      options?.commandKind === GitHubReviewRequestIngressCommandKind.Cancel
        ? {
            ...common,
            commandKind: GitHubReviewRequestIngressCommandKind.Cancel,
            triggerAction: GitHubReviewRequestTriggerAction.Closed,
          }
        : {
            ...common,
            commandKind: GitHubReviewRequestIngressCommandKind.Request,
            triggerAction: GitHubReviewRequestTriggerAction.Synchronize,
            expectedBaseSha: "a".repeat(40),
            expectedHeadSha: "b".repeat(40),
            draftAtIngress: false,
          },
    status: "processing",
    attempts: 1,
    maxAttempts: 20,
    nextAttemptAt: null,
    claimId: "claim-1",
    claimVersion: 1n,
    claimOwnerHash: "owner-1",
    claimUntil: new Date("2026-07-23T10:01:00.000Z"),
    occurredAt: now,
  };
}
