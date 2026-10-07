import { describe, expect, it, vi } from "vitest";
import { OctokitCertifiedForkWorkflowRunResolver } from "./octokit-certified-fork-workflow-run-resolver.js";

describe("certified fork workflow run resolver", () => {
  it("uses a bounded GitHub request and verifies the exact run identity", async () => {
    const request = vi.fn(async (route: string) =>
      route === "GET /repos/{owner}/{repo}"
        ? { data: { id: 99, default_branch: "main" } }
        : { data: run(2, [{ number: 42 }]) },
    );
    const resolver = new OctokitCertifiedForkWorkflowRunResolver({
      app: { getInstallationOctokit: () => ({ request }) },
    });
    await expect(
      resolver.resolveWorkflowRunPullRequest({
        repository: {
          githubInstallationId: "7",
          githubRepositoryId: "99",
          fullName: "owner/example",
          owner: "owner",
        },
        githubRunId: "700",
        githubRunAttempt: "2",
        eventName: "pull_request_target",
        expectedPullRequestNumber: 42,
        expectedReviewHeadSha: "b".repeat(40),
        workflow: workflow(),
      }),
    ).resolves.toBe(42);
    expect(request).toHaveBeenCalledWith(
      "GET /repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt_number}",
      expect.objectContaining({ request: { timeout: 15_000 } }),
    );
  });

  it.each([[], null])(
    "uses the expected PR when GitHub omits fork run associations (%p)",
    async (pullRequests) => {
      const resolver = new OctokitCertifiedForkWorkflowRunResolver({
        app: {
          getInstallationOctokit: () => ({
            request: vi.fn(async (route: string) =>
              route === "GET /repos/{owner}/{repo}"
                ? { data: { id: 99, default_branch: "main" } }
                : { data: run(1, pullRequests) },
            ),
          }),
        },
      });

      await expect(
        resolver.resolveWorkflowRunPullRequest({
          repository: {
            githubInstallationId: "7",
            githubRepositoryId: "99",
            fullName: "owner/example",
            owner: "owner",
          },
          githubRunId: "700",
          githubRunAttempt: "1",
          eventName: "pull_request_target",
          expectedPullRequestNumber: 42,
          expectedReviewHeadSha: "b".repeat(40),
          workflow: workflow(),
        }),
      ).resolves.toBe(42);
    },
  );

  it("rejects a run for a different PR head", async () => {
    const resolver = new OctokitCertifiedForkWorkflowRunResolver({
      app: {
        getInstallationOctokit: () => ({
          request: vi.fn(async (route: string) =>
            route === "GET /repos/{owner}/{repo}"
              ? { data: { id: 99, default_branch: "main" } }
              : { data: { ...run(1, []), head_sha: "d".repeat(40) } },
          ),
        }),
      },
    });

    await expect(
      resolver.resolveWorkflowRunPullRequest({
        repository: {
          githubInstallationId: "7",
          githubRepositoryId: "99",
          fullName: "owner/example",
          owner: "owner",
        },
        githubRunId: "700",
        githubRunAttempt: "1",
        eventName: "pull_request_target",
        expectedPullRequestNumber: 42,
        expectedReviewHeadSha: "b".repeat(40),
        workflow: workflow(),
      }),
    ).rejects.toThrow("certified_fork_workflow_run_identity_mismatch");
  });
});

function workflow() {
  return {
    path: ".github/workflows/reviewrouter-fork.yml",
    ref: "refs/heads/main",
    workflowRef:
      "owner/example/.github/workflows/reviewrouter-fork.yml@refs/heads/main",
    workflowSha: "c".repeat(40),
  };
}

function run(attempt: number, pullRequests: unknown) {
  return {
    event: "pull_request_target",
    run_attempt: attempt,
    repository: { id: 99, full_name: "owner/example" },
    path: ".github/workflows/reviewrouter-fork.yml",
    head_branch: "feature/review",
    head_sha: "b".repeat(40),
    pull_requests: pullRequests,
  };
}
